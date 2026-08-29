/**
 * GrantOnce authorization properties. These are the spec:
 * income never enters a grant, fields:* 403, audience mismatch,
 * consume clears plaintext, wildcard and overscope fail closed.
 */
process.env.GRANTONCE_STORE ??= `/tmp/grantonce-authz-test-${process.pid}.json`;

import { approveGrantAndFetch, fetchWithGrant, peekEnvelope, proposeGrantsFromPlan, submitApplication } from "./authz";
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
  return getState();
}

function main() {
  const seeded = seedApproved();
  assert(incomeNeverGranted(seeded), "income is never in grant.fields");
  assert(
    seeded.grants.every((g) => !g.fields.some((id) => INCOME_FIELDS.includes(id))),
    "no grant allowlist includes income",
  );
  assert(
    seeded.grants.every((g) => g.signature.alg === "unsigned-demo"),
    "demo grants are unsigned-demo for passkey teammate",
  );
  assert(
    seeded.grants.every((g) => g.claims.jti.startsWith("grn_")),
    "jti is unguessable grn_ token",
  );
  assert(
    seeded.grants.find((g) => g.id === "G-甲")?.claims.aud === "agency-jia",
    "G-甲 aud is agency-jia",
  );
  assert(
    seeded.grants.find((g) => g.id === "G-乙")?.claims.aud === "agency-yi",
    "G-乙 aud is agency-yi",
  );
  assert(
    Object.values(seeded.envelopes).every(
      (envelope) => !INCOME_FIELDS.some((id) => id in envelope.fields),
    ),
    "income is not in any envelope after approve",
  );

  const wildcard = fetchWithGrant("G-乙", ["fields:*"], {
    id: "agency-yi",
    name: "乙",
  });
  assert(!wildcard.result.ok, "fields:* denied");
  assert(
    wildcard.result.ok === false && wildcard.result.code === "WILDCARD_FORBIDDEN",
    "fields:* code WILDCARD_FORBIDDEN",
  );

  const star = fetchWithGrant("G-甲", ["*"], { id: "agency-jia" });
  assert(
    star.result.ok === false && star.result.code === "WILDCARD_FORBIDDEN",
    "* wildcard forbidden",
  );

  const overscope = fetchWithGrant("G-乙", HOUSEHOLD_FIELDS, { id: "agency-yi" });
  assert(
    overscope.result.ok === false && overscope.result.code === "OVERSCOPED",
    "乙 household is OVERSCOPED",
  );
  assert(
    overscope.result.ok === false && overscope.result.status === 403,
    "overscope is 403",
  );

  const jiaJti = getState().grants.find((g) => g.id === "G-甲")?.claims.jti;
  assert(jiaJti, "G-甲 has jti");
  const wrongAud = fetchWithGrant(jiaJti, JIA_FIELDS, { id: "agency-yi" });
  assert(
    wrongAud.result.ok === false && wrongAud.result.code === "AUDIENCE_MISMATCH",
    "乙 holding 甲 jti is AUDIENCE_MISMATCH",
  );

  const jiaPower = fetchWithGrant("G-甲", YI_FIELDS, { id: "agency-jia" });
  assert(
    jiaPower.result.ok === false && jiaPower.result.code === "OVERSCOPED",
    "甲 requesting 電號 is OVERSCOPED",
  );

  const peek = peekEnvelope("G-乙", { id: "agency-jia" });
  assert(
    peek.result.ok === false && peek.result.code === "AUDIENCE_MISMATCH",
    "甲 peeking 乙 envelope is AUDIENCE_MISMATCH",
  );

  const missingPresenter = fetchWithGrant("G-甲", JIA_FIELDS, null);
  assert(
    missingPresenter.result.ok === false &&
      missingPresenter.result.code === "AUDIENCE_MISMATCH",
    "missing presenter is AUDIENCE_MISMATCH",
  );

  const before = getState().envelopes["G-甲"].fields;
  const expectedHash = hashFieldPayload(before);
  const submitted = submitApplication("G-甲");
  assert(!submitted.error, "submit G-甲");
  const envelope = getState().envelopes["G-甲"];
  assert(Object.keys(envelope.fields).length === 0, "plaintext cleared on consume");
  assert(envelope.receipt?.hash === expectedHash, "receipt hash matches pre-submit payload");
  assert(
    !JSON.stringify(envelope.fields).includes(VAULT.records["household.address"]),
    "consumed envelope json has no address",
  );

  const replay = fetchWithGrant("G-甲", JIA_FIELDS, { id: "agency-jia" });
  assert(
    replay.result.ok === false && replay.result.code === "GRANT_INACTIVE",
    "replay after consume is GRANT_INACTIVE",
  );

  const protocol = getState().lastProtocol;
  assert(protocol?.response.code === "GRANT_INACTIVE", "inspector captured replay 403");
  assert(protocol?.request.authorization.startsWith("Bearer Grant "), "inspector has Bearer");

  console.log("");
  console.log(`authz properties: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main();
