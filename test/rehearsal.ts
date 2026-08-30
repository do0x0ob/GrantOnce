/**
 * Executable run-through of pitch/demo-script.md.
 *
 * Every assertion corresponds to a sentence said out loud on stage. It drives
 * the running app over HTTP, so it exercises the API routes and the view
 * serialiser rather than calling the library directly.
 *
 *   npm run dev
 *   npm run test:rehearsal
 */
import { b64u, keyPairFromSeed, sign } from "../lib/crypto";

const BASE = process.env.BASE ?? "http://127.0.0.1:43127";
const wallet = keyPairFromSeed("rehearsal-principal");
const publicKey = b64u(wallet.publicKey);

let pass = 0;
const failures: string[] = [];

function say(line: string) {
  console.log("\n" + line);
}
function check(claim: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log("  ok   " + claim);
  } else {
    failures.push(claim);
    console.log("  FAIL " + claim + " " + detail);
  }
}

type View = {
  principal: { key: { registered: boolean; method: string | null } };
  grants: {
    id: string;
    status: string;
    claims: { claimId: string; label: string; shape: string; sensitivity: string }[];
    displayText: string;
    serialized: string;
    jti: string;
    exp: string;
    cnfJkt: string;
    programTitle: string;
  }[];
  inboxes: Record<
    string,
    {
      claims: { claimId: string; label: string; value: string; issuerSignatureValid: boolean }[];
      receivedAt: string | null;
      submittedAt: string | null;
      lastDenial: string | null;
    }
  >;
  wallet: {
    claimId: string;
    label: string;
    issuedAt: string;
    expiresAt: string;
    audience: string | null;
    presentedCount: number;
  }[];
  vaultCatalog: { fieldId: string; label: string; sealed: boolean; neverLeft: boolean }[];
  notifications: { title: string; body: string; kind: string }[];
  delegation: { active: boolean; grantTtlSeconds: number };
  audit: { action: string; detail: string }[];
  usedJtiCount: number;
  error?: string;
  code?: string;
};

async function post(path: string, body?: unknown): Promise<{ status: number; view: View }> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, view: (await res.json()) as View };
}
async function get(): Promise<View> {
  return (await fetch(BASE + "/api/state")).json() as Promise<View>;
}

/** Values that must never appear in anything the browser or an agency receives. */
const VAULT_SECRETS = [
  "林小禾",
  "板橋",
  "HH-DEMO-3388",
  "NHI-DEMO-2201",
  "720,000",
  "TP-DEMO-551002",
  "2025-07-15",
  "示範路",
];

function leaksIn(payload: unknown): string[] {
  const blob = JSON.stringify(payload);
  return VAULT_SECRETS.filter((v) => blob.includes(v));
}

const grantOf = (view: View, id: string) => view.grants.find((g) => g.id === id)!;

async function main() {
  await post("/api/reset");

  say("STEP 1 - the key is derived from the passkey PRF; the server only holds the public half");
  {
    const { view } = await post("/api/wallet/register", { publicKey, method: "software" });
    check("registration lands", view.principal.key.registered);
    check(
      "response carries no private key material",
      !JSON.stringify(view.principal.key).includes(b64u(wallet.secret)),
    );
  }

  say("STEP 2 - the rule engine decides eligibility; two capsules appear");
  {
    const { view } = await post("/api/chat", { message: "我剛搬家，看我能申請什麼。" });
    check("two capsules", view.grants.length === 2, "got " + view.grants.length);
    check("both awaiting signature", view.grants.every((g) => g.status === "proposed"));
  }

  say("STEP 3 - the agency receives four facts; no name, address, household id or birth date");
  {
    const view = await get();
    const jia = grantOf(view, "G-甲");
    check("childcare capsule holds exactly four claims", jia.claims.length === 4, JSON.stringify(jia.claims.map((c) => c.claimId)));
    check(
      "all four are predicates, no raw field",
      jia.claims.every((c) => c.sensitivity === "predicate"),
      JSON.stringify(jia.claims.map((c) => [c.claimId, c.sensitivity])),
    );
    const ids = jia.claims.map((c) => c.claimId);
    check(
      "exactly the four the script names",
      ["resident.inNewTaipei", "resident.movedWithin12m", "parentChild.verified", "child.ageBand"].every(
        (i) => ids.includes(i),
      ),
      ids.join(","),
    );

    say("STEP 3b - the energy agency gets a usage band plus a pseudonym of its own, not the meter id");
    const yi = grantOf(view, "G-乙");
    const yids = yi.claims.map((c) => c.claimId);
    check("holds usage band", yids.includes("power.usageBand"));
    check("holds agency-specific pseudonym", yids.includes("power.accountRef"));
    check("holds no raw claim", !yids.some((i) => i.startsWith("raw.")), yids.join(","));
  }

  say("STEP 4 - the displayed consent text is signed too, alongside aud, cnf, jti and a 5 minute expiry");
  {
    const jia = grantOf(await get(), "G-甲");
    const body = JSON.parse(jia.serialized) as Record<string, unknown>;
    check("signed bytes contain the consent text", body.displayText === jia.displayText);
    check("consent text matches what the card renders", jia.displayText.includes("新北市政府社會局 將取得以下關於你的資訊"));
    check("signed scope includes aud", body.aud === "jia");
    check("signed scope includes cnf", JSON.stringify(body.cnf) === JSON.stringify({ jkt: jia.cnfJkt }), jia.serialized);
    check("the key binding is literally in the signed bytes", jia.serialized.includes(jia.cnfJkt));
    check("signed scope includes jti", body.jti === jia.jti);
    const ttl = (new Date(jia.exp).getTime() - new Date(String(body.iat)).getTime()) / 1000;
    check("expiry is exactly 600s as the script says", ttl === 600, ttl + "s");
    check("consent text cites the statute", jia.displayText.includes("個人資料保護法 §15"));
  }

  say("STEP 5 - both keys turn; each claim carries the issuer signature the agency can verify itself");
  {
    const jia = grantOf(await get(), "G-甲");
    const signed = await post("/api/grants/sign", {
      grantId: "G-甲",
      signature: sign(jia.serialized, wallet.secret),
      publicKey,
    });
    check("signature accepted", grantOf(signed.view, "G-甲").status === "signed");

    // The script signs both capsules here, then redeems only the first. The
    // attack step below depends on the second being signed-but-unredeemed,
    // otherwise it reports UNSIGNED rather than the audience mismatch narrated.
    const yiGrant = grantOf(signed.view, "G-乙");
    await post("/api/grants/sign", {
      grantId: "G-乙",
      signature: sign(yiGrant.serialized, wallet.secret),
      publicKey,
    });

    const redeemed = await post("/api/grants/redeem", { grantId: "G-甲", agency: "jia" });
    check("redemption succeeds", redeemed.status === 200, JSON.stringify(redeemed.view.error ?? redeemed.view.code));
    const inbox = redeemed.view.inboxes["childcare-allowance"];
    check("inbox holds four claims", inbox.claims.length === 4);
    check("every claim has a valid issuer signature", inbox.claims.every((c) => c.issuerSignatureValid));
    check(
      "delivered values are booleans and bands only",
      inbox.claims.every((c) => ["true", "false", "0-2", "2-6", "6+"].includes(c.value)),
      JSON.stringify(inbox.claims.map((c) => c.value)),
    );

    say("STEP 5b - used fields are marked as derived; income stays sealed and never authorised");
    const sealed = redeemed.view.vaultCatalog.filter((e) => e.sealed);
    check(
      "sealed fields never contributed to a credential",
      sealed.length > 0 && sealed.every((e) => e.neverLeft),
      JSON.stringify(sealed.map((e) => [e.label, e.neverLeft])),
    );
    check("some fields are marked derived", redeemed.view.vaultCatalog.some((e) => !e.neverLeft));
    check("whole response leaks no vault value", leaksIn(redeemed.view).length === 0, leaksIn(redeemed.view).join(","));
  }

  say("STEP 6a - redeeming with the wrong agency: audience mismatch, it is not a bearer token");
  {
    // This is what the button on the first agency's card actually does: present
    // the *other* agency's capsule.
    const r = await post("/api/grants/redeem", { grantId: "G-乙", agency: "jia" });
    check("refused with 403", r.status === 403);
    check("code is WRONG_AUDIENCE", r.view.code === "WRONG_AUDIENCE", String(r.view.code));
    check("the 403 body leaks no vault value", leaksIn(r.view).length === 0, leaksIn(r.view).join(","));
  }

  say("STEP 6b - replaying a redeemed capsule: the one-time id is already burnt");
  {
    const r = await post("/api/grants/redeem", { grantId: "G-甲", agency: "jia" });
    check("refused", r.status === 403);
    check("code is REPLAYED", r.view.code === "REPLAYED", String(r.view.code));
    check("used jti count is non-zero", r.view.usedJtiCount > 0);
  }

  say("STEP 6c - asking for income and address: pushed to the principal, blocked at proposal time");
  {
    const before = (await get()).notifications.length;
    const r = await post("/api/agency/request", {
      agency: "jia",
      purpose: "childcare-allowance",
      claims: ["raw.income.annual", "raw.household.address"],
    });
    check("request blocked with 403", r.status === 403);
    check("a notification was pushed", r.view.notifications.length > before);
    const note = r.view.notifications[0];
    check("notification names the overreach", note.title.includes("攔截"), note.title);
    check("reason cites the statute", note.body.includes("§15"), note.body);
    check("reason cites special-category data", note.body.includes("特種"), note.body);
    check("reason cites the delegation ceiling", note.body.includes("委託設定"), note.body);
    check("the inbox gained nothing", r.view.inboxes["childcare-allowance"].claims.length === 4);
    check("blocked response leaks no vault value", leaksIn(r.view).length === 0, leaksIn(r.view).join(","));
  }

  say("STEP 7 - the parent-child credential lasts a year and is presented again, not re-fetched");
  {
    const view = await get();
    const pc = view.wallet.find((c) => c.claimId === "parentChild.verified");
    check("wallet holds the parent-child credential", Boolean(pc));
    if (pc) {
      const days = (new Date(pc.expiresAt).getTime() - new Date(pc.issuedAt).getTime()) / 86400000;
      check("its lifetime is one year", Math.round(days) === 365, Math.round(days) + " days");
    }
    const walletBefore = view.wallet.length;
    await post("/api/chat", { message: "我剛搬家，看我能申請什麼。" });
    const again = grantOf(await get(), "G-甲");
    await post("/api/grants/sign", {
      grantId: "G-甲",
      signature: sign(again.serialized, wallet.secret),
      publicKey,
    });
    const r = await post("/api/grants/redeem", { grantId: "G-甲", agency: "jia" });
    check("second application redeems", r.status === 200, String(r.view.code));
    check("no new credential was issued", r.view.wallet.length === walletBefore, walletBefore + " -> " + r.view.wallet.length);
    const pc2 = r.view.wallet.find((c) => c.claimId === "parentChild.verified")!;
    check("the same credential was presented again", pc2.presentedCount >= 2, "presented " + pc2.presentedCount);
    const issued = r.view.audit.filter((a) => a.action === "issue").length;
    check("audit shows issuance happened once", issued === 1, issued + " issuances");
  }

  say("STEP 7b - the two agencies get different identifiers and cannot join their records");
  {
    // Step 7 re-ran the application, which re-proposes both capsules with fresh
    // one-time ids, so the energy capsule needs signing again.
    const yi = grantOf(await get(), "G-乙");
    await post("/api/grants/sign", {
      grantId: "G-乙",
      signature: sign(yi.serialized, wallet.secret),
      publicKey,
    });
    const r = await post("/api/grants/redeem", { grantId: "G-乙", agency: "yi" });
    check("energy capsule redeems", r.status === 200, String(r.view.code));
    const ref = r.view.inboxes["aircon-subsidy"].claims.find((c) => c.claimId === "power.accountRef")!;
    check("what it received is a pseudonym", ref.value.startsWith("PP-"), ref.value);
    check("the other agency never saw that identifier", !JSON.stringify(r.view.inboxes["childcare-allowance"]).includes(ref.value));
  }

  say("STEP 8 - the child turns two: eligibility is pushed, and the old capsule is not carried over");
  {
    const r = await post("/api/clock", { offsetDays: 400 });
    check(
      "childcare capsule no longer stands",
      !r.view.grants.some((g) => g.id === "G-甲"),
      r.view.grants.map((g) => g.id).join(","),
    );
    check(
      "moving the clock pushes on its own, without a separate scan",
      r.view.notifications.some((n) => n.kind === "eligibility-change"),
      JSON.stringify(r.view.notifications.map((n) => n.kind)),
    );
    await post("/api/clock", { offsetDays: 0 });
  }

  say("STEP 9 - stopping the delegation is instant; what was already delivered cannot be recalled");
  {
    await post("/api/chat", { message: "我剛搬家，看我能申請什麼。" });
    const beforeInbox = (await get()).inboxes["childcare-allowance"].claims.length;
    const r = await post("/api/delegation", { action: "revoke", reason: "彩排" });
    check("delegation stopped", !r.view.delegation.active);
    check(
      "every unredeemed capsule is void",
      r.view.grants.every((g) => g.status !== "proposed" && g.status !== "signed"),
      JSON.stringify(r.view.grants.map((g) => [g.id, g.status])),
    );
    const blocked = await post("/api/grants/redeem", { grantId: "G-乙", agency: "yi" });
    check("no redemption succeeds afterwards", blocked.status === 403, String(blocked.status));
    check("already-delivered claims remain with the agency", r.view.inboxes["childcare-allowance"].claims.length === beforeInbox);
    await post("/api/delegation", { action: "restore" });
  }

  say("STEP 10 - the audit trail carries every action type");
  {
    await post("/api/chat", { message: "我剛搬家，看我能申請什麼。" });
    const g = grantOf(await get(), "G-甲");
    await post("/api/grants/sign", { grantId: "G-甲", signature: sign(g.serialized, wallet.secret), publicKey });
    await post("/api/grants/redeem", { grantId: "G-甲", agency: "jia" });
    const r = await post("/api/applications/submit", { grantId: "G-甲" });
    check("submission succeeds", r.status === 200, String(r.view.error));

    const actions = new Set(r.view.audit.map((a) => a.action));
    for (const a of ["register", "issue", "sign", "redeem", "submit", "revoke", "deny", "notify"]) {
      check("audit records " + a, actions.has(a));
    }
    check("the audit trail leaks no vault value", leaksIn(r.view.audit).length === 0, leaksIn(r.view.audit).join(","));
  }

  say("EXPIRY - the capsule must outlive a demo plus questions");
  {
    await post("/api/reset");
    await post("/api/wallet/register", { publicKey, method: "software" });
    await post("/api/chat", { message: "我剛搬家，看我能申請什麼。" });
    const fresh = grantOf(await get(), "G-甲");
    const ttl = (new Date(fresh.exp).getTime() - Date.now()) / 1000;
    check("at least ten minutes of budget", ttl > 590, Math.round(ttl) + "s");
  }

  say("CURTAIN - final global leak sweep");
  {
    const view = await get();
    check("final state leaks no vault value", leaksIn(view).length === 0, leaksIn(view).join(","));
  }

  // The harness drives the live app, so hand it back reset rather than
  // half-consumed with a burnt audit trail.
  await post("/api/reset");
  console.log("\n" + pass + " passed, " + failures.length + " failed");
  if (failures.length) {
    console.log("failed: " + failures.join(" | "));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
