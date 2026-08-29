/**
 * Happy-path walk through GrantOnce MCP tools.
 * Fetch/submit take HMAC tickets only — never an actor parameter.
 */
process.env.GRANTONCE_STORE ??= `/tmp/grantonce-mcp-test-${process.pid}.json`;

async function main() {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import(
    "@modelcontextprotocol/sdk/inMemory.js"
  );
  const { HOUSEHOLD_FIELDS, JIA_FIELDS, INCOME_FIELDS } = await import("../lib/fields");
  const { HAPPY_PATH_UTTERANCE } = await import("../lib/rules");
  const { getState, resetState } = await import("../lib/store");
  const { revokeGrant } = await import("../lib/authz");
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
    ticketId: string | null;
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
  const fetchTool = listed.tools.find((t) => t.name === "fetch_field");
  const fetchProps = (fetchTool?.inputSchema as { properties?: Record<string, unknown> })
    ?.properties;
  const submitTool = listed.tools.find((t) => t.name === "submit_application");
  const submitProps = (submitTool?.inputSchema as { properties?: Record<string, unknown> })
    ?.properties;
  const approveTool = listed.tools.find((t) => t.name === "approve_grant");
  const approveProps = (approveTool?.inputSchema as { properties?: Record<string, unknown> })
    ?.properties;
  assert(approveProps && !("actor" in approveProps), "approve_grant has no actor param");
  assert(fetchProps && "ticket" in fetchProps, "fetch_field takes ticket");
  assert(submitProps && "ticket" in submitProps, "submit_application takes ticket");
  for (const tool of listed.tools) {
    const props = (tool.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {};
    assert(!("actor" in props), `${tool.name} has no actor param`);
    assert(!("caller" in props), `${tool.name} has no caller param`);
  }

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
  assert(plannedYi?.audience === "agency-yi", "G-乙 audience is agency-yi");
  assert(
    planned.every((g) => !g.fields.some((id) => id.startsWith("income."))),
    "income never enters a proposed grant",
  );

  const noTicket = await call(client, "fetch_field", {
    ticket: "G-yi",
    fields: HOUSEHOLD_FIELDS,
  });
  assert(noTicket.data.ok === false, "slot id G-yi is not a ticket");
  assert(noTicket.data.code === "BAD_TICKET", "guessable slot is BAD_TICKET");

  const missingTicket = await call(client, "fetch_field", { fields: HOUSEHOLD_FIELDS });
  assert(missingTicket.data.ok === false, "fetch without ticket denied");
  assert(missingTicket.data.code === "BAD_TICKET", "missing ticket is BAD_TICKET");

  const approveJia = await call(client, "approve_grant", { grantId: "G-jia" });
  assert(approveJia.data.ok === true, "approve_grant G-甲");
  const ticketJia = approveJia.data.ticket as string;
  assert(typeof ticketJia === "string" && ticketJia.startsWith("grn_"), "approve returns ticket");
  assert(ticketJia.includes("."), "ticket includes HMAC mac");
  const approvedJia = approveJia.data.grant as PublicGrant;
  assert(approvedJia.status === "active", "G-甲 is active");
  assert(approvedJia.issuer === "P-lin-demo", "approve does not override issuer");
  assert(approvedJia.audience === "agency-jia", "approved G-甲 keeps audience");

  const approveYi = await call(client, "approve_grant", { grantId: "G-乙" });
  assert(approveYi.data.ok === true, "approve_grant G-乙");
  const ticketYi = approveYi.data.ticket as string;
  assert(ticketYi.startsWith("grn_"), "G-乙 ticket issued");

  const overscope = await call(client, "fetch_field", {
    ticket: ticketYi,
    fields: HOUSEHOLD_FIELDS,
  });
  assert(overscope.data.ok === false, "fetch_field household on 乙 ticket is denied");
  assert(overscope.data.status === 403, "deny is HTTP 403");
  assert(overscope.data.code === "OVERSCOPED", "deny code OVERSCOPED");
  assert(overscope.result.isError === true, "MCP marks 403 as isError");

  const submitNoTicket = await call(client, "submit_application", {});
  assert(submitNoTicket.data.ok === false, "submit without ticket denied");
  assert(submitNoTicket.data.code === "BAD_TICKET", "submit missing ticket is BAD_TICKET");

  const submit = await call(client, "submit_application", { ticket: ticketJia });
  assert(submit.data.ok === true, "submit_application consumes G-甲");
  assert(
    (submit.data.grant as { status: string }).status === "consumed",
    "G-甲 status consumed",
  );

  const envelopeJia = getState().envelopes["G-甲"];
  assert(Object.keys(envelopeJia.fields).length === 0, "consumed envelope has no plaintext");
  assert(Boolean(envelopeJia.receipt?.hash), "consumed envelope has receipt hash");
  assert(
    !envelopeJia.receipt?.fieldIds.some((id) =>
      (INCOME_FIELDS as readonly string[]).includes(id),
    ),
    "receipt does not list income",
  );

  const replay = await call(client, "fetch_field", {
    ticket: ticketJia,
    fields: JIA_FIELDS,
  });
  assert(replay.data.ok === false, "replay fetch after submit denied");
  assert(replay.data.code === "GRANT_INACTIVE" || replay.data.code === "BAD_TICKET", "replay denied");

  const revokeSpoof = revokeGrant("G-乙", "假冒撤銷", { id: "agency-jia" });
  assert(!revokeSpoof.result.ok, "non-issuer cannot revoke");
  assert(revokeSpoof.result.ok === false && revokeSpoof.result.code === "ISSUER_MISMATCH", "ISSUER_MISMATCH");

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
  assert(audit.data.incomeNeverEnteredGrant === true, "income never entered a grant");
  const entries = audit.data.audit as { action: string; grantId: string | null }[];
  const actions = new Set(entries.map((e) => e.action));
  for (const action of ["approve", "fetch", "submit", "revoke", "deny", "receipt"] as const) {
    assert(actions.has(action), `audit contains ${action}`);
  }

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
