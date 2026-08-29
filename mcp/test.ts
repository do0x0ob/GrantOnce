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
  const { HOUSEHOLD_FIELDS, JIA_FIELDS, YI_FIELDS } = await import("../lib/fields");
  const { HAPPY_PATH_UTTERANCE } = await import("../lib/rules");
  const { resetState } = await import("../lib/store");
  const { createGrantOnceServer } = await import("./server");
  const { TOOL_NAMES, vaultLeakIn } = await import("./tools");

  type Json = Record<string, unknown>;
  type PublicGrant = {
    id: string;
    issuer: string;
    subject: string;
    audience: string;
    status: string;
    fields: string[];
  };

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

  const planned = plan.data.grants as PublicGrant[];
  const plannedJia = planned.find((g) => g.id === "G-甲");
  const plannedYi = planned.find((g) => g.id === "G-乙");
  assert(Boolean(plannedJia && plannedYi), "plan returns both grant objects");
  assert(plannedJia?.issuer === "P-lin-demo", "G-甲 issuer is principal id");
  assert(plannedYi?.issuer === "P-lin-demo", "G-乙 issuer is principal id");
  assert(
    planned.every((g) => g.issuer && g.issuer !== "林曉晴"),
    "issuer is not hardcoded 林曉晴",
  );
  assert(plannedJia?.audience === "agency-jia", "G-甲 audience is agency-jia");
  assert(plannedYi?.audience === "agency-yi", "G-乙 audience is agency-yi");
  assert(plannedJia?.subject === "P-lin-demo", "G-甲 subject is vault principal");
  assert(
    planned.every((g) => !g.fields.some((id) => id.startsWith("income."))),
    "income never enters a proposed grant",
  );

  const approveJia = await call(client, "approve_grant", { grantId: "G-jia" });
  assert(approveJia.data.ok === true, "approve_grant G-甲");
  const approvedJia = approveJia.data.grant as PublicGrant;
  assert(approvedJia.status === "active", "G-甲 is active");
  assert(
    approvedJia.issuer === "P-lin-demo",
    "approve does not override issuer from the session",
  );
  assert(approvedJia.audience === "agency-jia", "approved G-甲 keeps audience");

  const approveYi = await call(client, "approve_grant", { grantId: "G-乙" });
  assert(approveYi.data.ok === true, "approve_grant G-乙");
  assert(
    (approveYi.data.grant as PublicGrant).issuer === "P-lin-demo",
    "G-乙 issuer stays session principal id",
  );

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

  const stealFetch = await call(client, "fetch_field", {
    grantId: "G-乙",
    fields: YI_FIELDS,
    actor: "agency-jia",
  });
  assert(stealFetch.data.ok === false, "甲 using 乙's grant is denied");
  assert(stealFetch.data.status === 403, "audience mismatch is 403");
  assert(
    stealFetch.data.code === "AUDIENCE_MISMATCH",
    "甲/乙 audience mismatch code",
  );
  assert(stealFetch.data.audited === true, "audience mismatch is audited");

  const stealSubmit = await call(client, "submit_application", {
    grantId: "G-乙",
    actor: "agency-jia",
  });
  assert(stealSubmit.data.ok === false, "甲 submit on 乙's grant is denied");
  assert(stealSubmit.data.status === 403, "submit audience mismatch is 403");
  assert(
    stealSubmit.data.code === "AUDIENCE_MISMATCH",
    "submit audience mismatch code",
  );
  assert(stealSubmit.data.audited === true, "submit audience mismatch audited");

  const missingActor = await call(client, "fetch_field", {
    grantId: "G-甲",
    fields: JIA_FIELDS,
  });
  assert(missingActor.data.ok === false, "fetch_field without actor denied");
  assert(missingActor.data.code === "MISSING_ACTOR", "missing actor code");

  const submit = await call(client, "submit_application", {
    grantId: "G-甲",
    actor: "agency-jia",
  });
  assert(submit.data.ok === true, "submit_application consumes G-甲");
  assert(
    (submit.data.grant as { status: string }).status === "consumed",
    "G-甲 status consumed",
  );

  const replay = await call(client, "fetch_field", {
    grantId: "G-甲",
    fields: JIA_FIELDS,
    actor: "agency-jia",
  });
  assert(replay.data.ok === false, "replay fetch after submit denied");
  assert(replay.data.status === 403, "replay is 403");
  assert(replay.data.code === "GRANT_INACTIVE", "replay code GRANT_INACTIVE");

  const stealRevoke = await call(client, "revoke_grant", {
    grantId: "G-乙",
    caller: "agency-jia",
    reason: "甲試圖撤銷乙匣",
  });
  assert(stealRevoke.data.ok === false, "non-issuer revoke is denied");
  assert(stealRevoke.data.status === 403, "non-issuer revoke is 403");
  assert(
    stealRevoke.data.code === "ISSUER_MISMATCH",
    "revoke-by-non-issuer code ISSUER_MISMATCH",
  );
  assert(stealRevoke.data.audited === true, "non-issuer revoke is audited");
  assert(
    (stealRevoke.data.grant as { status: string }).status === "active",
    "G-乙 stays active after failed revoke",
  );

  const revoke = await call(client, "revoke_grant", {
    grantId: "G-乙",
    reason: "演示撤銷乙匣",
  });
  assert(revoke.data.ok === true, "revoke_grant G-乙 by session issuer");
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
  const auditGrants = audit.data.grants as PublicGrant[];
  assert(
    auditGrants.every((g) => g.issuer === "P-lin-demo"),
    "audit grants keep session issuer ids",
  );
  const entries = audit.data.audit as {
    action: string;
    grantId: string | null;
    detail: string;
  }[];
  const actions = new Set(entries.map((e) => e.action));
  for (const action of ["approve", "fetch", "submit", "revoke", "deny"] as const) {
    assert(actions.has(action), `audit contains ${action}`);
  }
  assert(
    entries.some((e) => e.action === "deny" && e.grantId === "G-乙"),
    "audit has 乙 household deny",
  );
  assert(
    entries.some((e) => e.action === "deny" && e.detail.includes("audience")),
    "audit has audience mismatch",
  );
  assert(
    entries.some((e) => e.action === "deny" && e.detail.includes("issuer")),
    "audit has revoke-by-non-issuer",
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
