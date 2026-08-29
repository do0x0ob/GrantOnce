/**
 * Happy-path walk through GrantOnce MCP tools.
 * Uses the official MCP client + in-memory transport so the model-facing
 * tool surface is what we assert — never the vault.
 */
process.env.GRANTONCE_STORE ??= `/tmp/grantonce-mcp-test-${process.pid}.json`;

async function main() {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import(
    "@modelcontextprotocol/sdk/inMemory.js"
  );
  const { HOUSEHOLD_FIELDS, JIA_FIELDS } = await import("../lib/fields");
  const { HAPPY_PATH_UTTERANCE } = await import("../lib/rules");
  const { resetState } = await import("../lib/store");
  const { createGrantOnceServer } = await import("./server");
  const { TOOL_NAMES, vaultLeakIn } = await import("./tools");

  type Json = Record<string, unknown>;

  let failed = 0;
  let passed = 0;

  function assert(cond: unknown, message: string): asserts cond {
    if (!cond) {
      failed += 1;
      console.error(`FAIL  ${message}`);
      throw new Error(message);
    }
    passed += 1;
    console.log(`ok    ${message}`);
  }

  async function call(
    client: InstanceType<typeof Client>,
    name: string,
    args: Record<string, unknown> = {},
  ) {
    const result = await client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as Array<{
      type?: string;
      text?: string;
    }>;
    const text = content
      .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
      .join("\n");
    const leak = vaultLeakIn(text) ?? vaultLeakIn(result);
    if (leak) {
      throw new Error(`tool ${name} leaked vault (${leak})`);
    }
    const data = JSON.parse(text) as Json;
    return { result, data, text };
  }

  resetState();

  const mcp = createGrantOnceServer();
  const client = new Client({ name: "grantonce-test", version: "0.1.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);

  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name);
  assert(
    TOOL_NAMES.every((name) => names.includes(name)),
    `lists tools: ${TOOL_NAMES.join(", ")}`,
  );

  const plan = await call(client, "plan_applications", {
    utterance: HAPPY_PATH_UTTERANCE,
  });
  assert(plan.data.ok === true, "plan_applications matches 搬家 utterance");
  const programs = plan.data.programs as { grantId: string }[];
  assert(programs.some((p) => p.grantId === "G-甲"), "plan proposes G-甲");
  assert(programs.some((p) => p.grantId === "G-乙"), "plan proposes G-乙");

  const approveJia = await call(client, "approve_grant", { grantId: "G-jia" });
  assert(approveJia.data.ok === true, "approve_grant G-甲");
  assert(
    (approveJia.data.grant as { status: string }).status === "active",
    "G-甲 is active",
  );

  const approveYi = await call(client, "approve_grant", { grantId: "G-乙" });
  assert(approveYi.data.ok === true, "approve_grant G-乙");

  const overscope = await call(client, "fetch_field", {
    grantId: "G-yi",
    fields: HOUSEHOLD_FIELDS,
    actor: "agency-yi",
  });
  assert(overscope.data.ok === false, "fetch_field household on 乙 is denied");
  assert(overscope.data.status === 403, "deny is HTTP 403");
  assert(overscope.data.code === "OVERSCOPED", "deny code OVERSCOPED");
  assert(overscope.data.audited === true, "deny is audited");
  assert(overscope.result.isError === true, "MCP marks 403 as isError");

  const submit = await call(client, "submit_application", { grantId: "G-甲" });
  assert(submit.data.ok === true, "submit_application consumes G-甲");
  assert(
    (submit.data.grant as { status: string }).status === "consumed",
    "G-甲 status consumed",
  );

  const replay = await call(client, "fetch_field", {
    grantId: "G-甲",
    fields: JIA_FIELDS,
    actor: "agent",
  });
  assert(replay.data.ok === false, "replay fetch after submit denied");
  assert(replay.data.status === 403, "replay is 403");
  assert(replay.data.code === "GRANT_INACTIVE", "replay code GRANT_INACTIVE");

  const revoke = await call(client, "revoke_grant", {
    grantId: "G-乙",
    reason: "演示撤銷乙匣",
  });
  assert(revoke.data.ok === true, "revoke_grant G-乙");
  assert(
    (revoke.data.grant as { status: string }).status === "revoked",
    "G-乙 status revoked",
  );

  const audit = await call(client, "get_audit", {});
  assert(audit.data.ok === true, "get_audit ok");
  assert(
    audit.data.incomeNeverEnteredGrant === true,
    "income never entered a grant",
  );
  const entries = audit.data.audit as {
    action: string;
    grantId: string | null;
  }[];
  const actions = new Set(entries.map((e) => e.action));
  for (const action of ["approve", "fetch", "submit", "revoke", "deny"] as const) {
    assert(actions.has(action), `audit contains ${action}`);
  }
  assert(
    entries.some((e) => e.action === "deny" && e.grantId === "G-乙"),
    "audit has 乙 household deny",
  );

  await client.close();
  await mcp.close();

  console.log("");
  console.log(`MCP happy path: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
