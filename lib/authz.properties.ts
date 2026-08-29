/**
 * GrantOnce authorization properties. These are the spec:
 * income never enters a grant, fields:* 403, HMAC ticket required,
 * consume clears plaintext, wildcard and overscope fail closed.
 */
process.env.GRANTONCE_STORE ??= `/tmp/grantonce-authz-test-${process.pid}.json`;

import { approveGrantAndFetch, fetchWithGrant, proposeGrantsFromPlan, submitApplication } from "./authz";
import { HOUSEHOLD_FIELDS, INCOME_FIELDS, JIA_FIELDS, YI_FIELDS } from "./fields";
import { hashFieldPayload } from "./grant";
import { HAPPY_PATH_UTTERANCE, matchPrograms, situationFromUtterance } from "./rules";
import { getState, mutate, resetState } from "./store";
import { incomeNeverGranted } from "./view";
import { VAULT } from "./vault";

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    failed += 1;
    console.error(`FAIL  ${message}`);
    throw new Error(message);
  }
  passed += 1;
  console.log(`ok    ${message}`);
}

function seedApproved() {
  resetState();
  const situation = situationFromUtterance(HAPPY_PATH_UTTERANCE);
  if (!situation) throw new Error("happy path utterance should match");
  const programs = matchPrograms(situation);
  mutate((s) => {
    proposeGrantsFromPlan(s, programs);
  });
  const jia = approveGrantAndFetch("G-甲");
  const yi = approveGrantAndFetch("G-乙");
  if (jia.error || yi.error) throw new Error(jia.error ?? yi.error);
  if (!jia.ticket || !yi.ticket) throw new Error("approve must return HMAC tickets");
  return { state: getState(), jiaTicket: jia.ticket, yiTicket: yi.ticket };
}

function main() {
  const { state: seeded, jiaTicket, yiTicket } = seedApproved();
  assert(incomeNeverGranted(seeded), "income is never in grant.fields");
  assert(
    seeded.grants.every((g) => !g.fields.some((id) => id.startsWith("income."))),
    "no grant allowlist includes income",
  );
  assert(
    seeded.grants.every((g) => Boolean(g.ticket?.startsWith("grn_") && g.ticket.includes("."))),
    "approve issues HMAC tickets grn_….<mac>",
  );
  assert(
    seeded.grants.every((g) => g.ticketId?.startsWith("grn_")),
    "jti is unguessable grn_ token",
  );
  assert(
    seeded.grants.find((g) => g.id === "G-甲")?.audience === "agency-jia",
    "G-甲 audience is agency-jia",
  );
  assert(
    seeded.grants.find((g) => g.id === "G-乙")?.audience === "agency-yi",
    "G-乙 audience is agency-yi",
  );
  assert(
    Object.values(seeded.envelopes).every(
      (envelope) => !INCOME_FIELDS.some((id) => id in envelope.fields),
    ),
    "income is not in any envelope after approve",
  );
  assert(
    !JSON.stringify(seeded.grants.map((g) => ({ id: g.id, fields: g.fields, aud: g.audience }))).includes(
      "grantonce-demo-hmac-key",
    ),
    "HMAC key is not on grant objects",
  );

  const wildcard = fetchWithGrant(yiTicket, ["fields:*"]);
  assert(!wildcard.result.ok, "fields:* denied");
  assert(
    wildcard.result.ok === false && wildcard.result.code === "WILDCARD_FORBIDDEN",
    "fields:* code WILDCARD_FORBIDDEN",
  );

  const star = fetchWithGrant(jiaTicket, ["*"]);
  assert(
    star.result.ok === false && star.result.code === "WILDCARD_FORBIDDEN",
    "* wildcard forbidden",
  );

  const overscope = fetchWithGrant(yiTicket, HOUSEHOLD_FIELDS);
  assert(
    overscope.result.ok === false && overscope.result.code === "OVERSCOPED",
    "乙 household is OVERSCOPED",
  );
  assert(
    overscope.result.ok === false && overscope.result.status === 403,
    "overscope is 403",
  );

  const slotAsTicket = fetchWithGrant("G-jia", JIA_FIELDS);
  assert(
    slotAsTicket.result.ok === false && slotAsTicket.result.code === "BAD_TICKET",
    "slot id G-jia is BAD_TICKET",
  );

  const missing = fetchWithGrant("", JIA_FIELDS);
  assert(
    missing.result.ok === false && missing.result.code === "BAD_TICKET",
    "missing ticket is BAD_TICKET",
  );

  const jiaPower = fetchWithGrant(jiaTicket, YI_FIELDS);
  assert(
    jiaPower.result.ok === false && jiaPower.result.code === "OVERSCOPED",
    "甲 requesting 電號 is OVERSCOPED",
  );

  const jtiOnly = getState().grants.find((g) => g.id === "G-乙")?.ticketId;
  assert(jtiOnly, "G-乙 has ticket id");
  const byJti = fetchWithGrant(jtiOnly, YI_FIELDS);
  assert(byJti.result.ok, "runtime accepts opaque ticket id");

  const last = jiaTicket.slice(-1);
  const tampered = `${jiaTicket.slice(0, -1)}${last === "a" ? "b" : "a"}`;
  const badMac = fetchWithGrant(tampered, JIA_FIELDS);
  assert(
    badMac.result.ok === false && badMac.result.code === "BAD_TICKET",
    "tampered HMAC is BAD_TICKET",
  );

  const before = getState().envelopes["G-甲"].fields;
  const expectedHash = hashFieldPayload(before);
  const submitted = submitApplication(jiaTicket);
  assert(submitted.result.ok, "submit G-甲");
  const envelope = getState().envelopes["G-甲"];
  assert(Object.keys(envelope.fields).length === 0, "plaintext cleared on consume");
  assert(envelope.receipt?.hash === expectedHash, "receipt hash matches pre-submit payload");
  assert(
    !JSON.stringify(envelope.fields).includes(VAULT.records["household.address"]),
    "consumed envelope json has no address",
  );

  const replay = fetchWithGrant(jiaTicket, JIA_FIELDS);
  assert(
    replay.result.ok === false &&
      (replay.result.code === "GRANT_INACTIVE" || replay.result.code === "BAD_TICKET"),
    "replay after consume is denied",
  );

  const submitNoTicket = submitApplication("");
  assert(
    submitNoTicket.result.ok === false && submitNoTicket.result.code === "BAD_TICKET",
    "submit without ticket is BAD_TICKET",
  );

  const protocol = getState().lastProtocol;
  assert(protocol?.response.ok === false, "inspector captured denied request");
  assert(protocol?.request.authorization.startsWith("Bearer Grant "), "inspector has Bearer");

  console.log("");
  console.log(`authz properties: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main();
