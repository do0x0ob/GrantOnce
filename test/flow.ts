/**
 * End-to-end check of the two-key flow. Run with `npm run test:flow`.
 * Every assertion here corresponds to a claim the demo makes on stage.
 */
import { b64u, digest, keyPairFromSeed, pairwiseId, serializeBody, sign, utf8 } from "../lib/crypto";
import { sha256 } from "@noble/hashes/sha2";
import { CLAIM_DEFS, isClaimId } from "../lib/claims";
import { isPurposeId, PURPOSES } from "../lib/purposes";
import { purposesFrom, validatePurposeDraft } from "../lib/registry";
import { isLivePurposeId, retirePurpose, upsertPurpose } from "../lib/registry-io";
import { assessRisk } from "../lib/risk";
import {
  makeAgencyProof,
  proposeGrantsFromPlan,
  redeemGrant,
  registerPrincipalKey,
  requestClaims,
  restoreDelegation,
  revokeDelegation,
  revokeGrant,
  signGrant,
  submitApplication,
  updateDelegation,
} from "../lib/authz";
import { AGENCY_KEYS } from "../lib/parties";
import { originBlocker } from "../lib/passkey";
import { FLOOD_UTTERANCE } from "../lib/catalog";
import { evaluateInquiry } from "../lib/inquiry";
import { effectiveToday, matchPrograms, scanForChanges, situationFromUtterance } from "../lib/rules";
import { getState, mutate, resetState } from "../lib/store";
import { formatClock, formatDate, formatTime } from "../lib/view";
import { verifyCredential } from "../lib/wallet";
import type { Grant, GrantId } from "../lib/types";

let pass = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name} ${extra}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}

resetState();

// The principal's wallet key. In the browser this comes from the passkey PRF
// output; here we derive the same shape from a fixed seed.
const principal = keyPairFromSeed("test-principal");
const pk = b64u(principal.publicKey);


/**
 * Re-signs a capsule after editing it, so the principal's signature is genuinely
 * valid over the tampered content. This is the adversary that matters when
 * testing the second key and the purpose registry: a principal who signed
 * something they should not have, or was tricked into it.
 */
function resign(id: GrantId, edit: (body: Grant["body"]) => void) {
  mutate((s) => {
    const g = s.grants.find((x) => x.id === id)!;
    edit(g.body);
    g.serialized = serializeBody(g.body);
    g.digest = digest(g.serialized);
    g.signature = sign(g.serialized, principal.secret);
    g.signedByKey = pk;
    g.signMethod = "software";
    g.status = "signed";
    g.redeemedAt = null;
    s.usedJti = s.usedJti.filter((j) => j !== g.body.jti);
  });
}

function freshProposal() {
  mutate((s) => proposeGrantsFromPlan(s, matchPrograms(sit)));
}

section("註冊皮夾金鑰");
check("拒絕長度錯誤的公鑰", Boolean(registerPrincipalKey({ publicKey: "AAAA", method: "software" }).error));
check("接受合法 ed25519 公鑰", !registerPrincipalKey({ publicKey: pk, method: "software" }).error);

section("規則引擎比對");
const sit = situationFromUtterance("我剛搬家，看我能申請什麼。", effectiveToday(getState()))!;
const programs = matchPrograms(sit);
check("比對出兩個申請案", programs.length === 2);
check(
  "育兒津貼全是述詞，沒有任何原始欄位",
  programs[0].claims.every((c) => CLAIM_DEFS[c].sensitivity === "predicate"),
  JSON.stringify(programs[0].claims.map((c) => [c, CLAIM_DEFS[c].sensitivity])),
);
check(
  "任何提案都不含原始個資或特種個資",
  programs.every((p) =>
    p.claims.every((c) => CLAIM_DEFS[c].sensitivity === "predicate" || CLAIM_DEFS[c].sensitivity === "pseudonym"),
  ),
  JSON.stringify(programs.flatMap((p) => p.claims.map((c) => [c, CLAIM_DEFS[c].sensitivity]))),
);
check("冷氣補助用假名代替電號", programs[1].claims.includes("power.accountRef"));
{
  const flood = evaluateInquiry(FLOOD_UTTERANCE, effectiveToday(getState()));
  check("水災不能發票", flood.canIssue === false);
  check("水災不產出申請案", flood.programs.length === 0);
  check(
    "水災在可發票 profile 仍是未綁定",
    flood.catalog.some((entry) => entry.id === "flood-relief" && entry.issuable === false),
  );
  const before = getState().grants.length;
  mutate((s) => proposeGrantsFromPlan(s, flood.programs));
  check("水災路徑不建匣", getState().grants.length === before);
}
mutate((s) => proposeGrantsFromPlan(s, programs));

const jia: GrantId = "G-甲";
const yi: GrantId = "G-乙";
const grantOf = (id: GrantId) => getState().grants.find((g) => g.id === id)!;


section("簽署範圍");
{
  const g0 = grantOf(jia);
  // The whole binding in one assertion: nothing in the body may be missing from,
  // or differ from, the bytes the principal actually signs.
  check(
    "待簽 bytes 逐欄等於 body（巢狀的 cnf 也不例外）",
    JSON.stringify(JSON.parse(g0.serialized)) === serializeBody(g0.body) &&
      g0.serialized.includes(g0.body.cnf.jkt),
    g0.serialized,
  );
  // Key order must not change the bytes, or two identical grants would hash apart.
  const shuffled = Object.fromEntries(Object.entries(g0.body).reverse());
  check("欄位順序不同但序列化結果相同", serializeBody(shuffled) === g0.serialized);
}

section("匣的結構");
const g = grantOf(jia);
check("綁定受眾 aud", g.body.aud === "jia");
check("綁定機關金鑰指紋 cnf.jkt", g.body.cnf.jkt === AGENCY_KEYS.jia.jkt);
{
  // Uniqueness is the property that matters; a fixed prefix is not.
  const before = g.body.jti;
  mutate((st) => proposeGrantsFromPlan(st, matchPrograms(sit)));
  check("每次提案都換一個新的 jti", grantOf(jia).body.jti !== before, `${before} vs ${grantOf(jia).body.jti}`);
}
check(
  "有效期不超過目的上限",
  (new Date(g.body.exp).getTime() - new Date(g.body.iat).getTime()) / 1000 <=
    PURPOSES[g.body.purpose].maxTtlSeconds,
);
check(
  "同意畫面文字實際引用了登記表裡的法源",
  PURPOSES[g.body.purpose].legalBasis.every((basis) => g.body.displayText.includes(basis)),
  g.body.displayText,
);
{
  // The necessity sentence is signed along with the bullet list above it, so a
  // sentence that undercounts the capsule is a consent screen contradicting
  // itself. It read 「三件事」 while listing four predicates until this check
  // existed. Only purposes that state a count are checked; the rest describe
  // their claims in prose.
  const NUMERALS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  const miscounted = Object.values(PURPOSES).filter((def) => {
    const stated = /([零一二三四五六七八九十])件事/.exec(def.necessity);
    if (!stated) return false;
    const quoted = def.necessity.match(/「[^」]+」/g)?.length ?? 0;
    const count = NUMERALS.indexOf(stated[1]);
    return count !== quoted || count !== def.allowedClaims.length;
  });
  check(
    "同意文字宣稱的件數等於實際列舉的述詞數",
    miscounted.length === 0,
    miscounted.map((d) => d.title).join("、"),
  );
}
check("風險等級為一般", g.risk === "low", g.riskNotes.join("|"));

section("未簽署不得兌現");
{
  const r = redeemGrant(jia, makeAgencyProof("jia", jia));
  check("未簽 → UNSIGNED", !r.result.ok && r.result.code === "UNSIGNED", JSON.stringify(r.result));
}

section("委託人簽署");
check("錯誤簽章被拒", Boolean(signGrant({ grantId: jia, signature: sign("別的內容", principal.secret), publicKey: pk }).error));
check("正確簽章通過", !signGrant({ grantId: jia, signature: sign(grantOf(jia).serialized, principal.secret), publicKey: pk }).error);
check("狀態變 signed", grantOf(jia).status === "signed");

section("第二把鑰匙：機關");
{
  const r = redeemGrant(jia, makeAgencyProof("yi", jia));
  check("乙拿甲的匣 → WRONG_AUDIENCE", !r.result.ok && r.result.code === "WRONG_AUDIENCE", JSON.stringify(r.result));
}
{
  const forged = { ...makeAgencyProof("jia", jia), signature: sign("fake", keyPairFromSeed("attacker").secret) };
  const r = redeemGrant(jia, forged);
  check("偽造機關證明 → BAD_AGENCY_PROOF", !r.result.ok && r.result.code === "BAD_AGENCY_PROOF");
}

section("兌現");
{
  const r = redeemGrant(jia, makeAgencyProof("jia", jia));
  check("雙鑰匙齊備 → 通過", r.result.ok, JSON.stringify(r.result));
  const inbox = getState().inboxes.jia;
  check("收件匣有四項述詞", inbox.claims.length === 4);
  check("收件匣不含姓名/地址/戶號/生日", !JSON.stringify(inbox.claims).match(/林小禾|板橋|HH-DEMO|2025-07-15/), JSON.stringify(inbox.claims));
  check("述詞值是是非題", inbox.claims.some((c) => c.value === "true") && inbox.claims.some((c) => c.value === "0-2"));
  check("每項都有發證機構簽章且有效", inbox.claims.every((c) => c.issuerSignatureValid));
}

section("重放");
{
  const r = redeemGrant(jia, makeAgencyProof("jia", jia));
  check("再兌現一次 → REPLAYED", !r.result.ok && r.result.code === "REPLAYED");
}

section("金庫外洩檢查");
{
  const blob = JSON.stringify(getState().inboxes);
  const leaks = ["林小禾", "板橋", "HH-DEMO-3388", "NHI-DEMO", "720,000", "TP-DEMO", "286", "2025-07-15"];
  const found = leaks.filter((v) => blob.includes(v));
  check("兩個收件匣都沒有任何金庫原始值", found.length === 0, found.join(","));
}

section("成對假名");
{
  signGrant({ grantId: yi, signature: sign(grantOf(yi).serialized, principal.secret), publicKey: pk });
  const r = redeemGrant(yi, makeAgencyProof("yi", yi));
  check("乙匣兌現成功", r.result.ok, JSON.stringify(r.result));
  const yiRef = getState().inboxes.yi.claims.find((c) => c.claimId === "power.accountRef")!;
  check("乙拿到的是假名不是電號", !yiRef.value.includes("TP-DEMO") && yiRef.value.startsWith("PP-"), yiRef.value);
  const jiaBlob = JSON.stringify(getState().inboxes.jia);
  check("甲拿不到同一個代號（無法串接）", !jiaBlob.includes(yiRef.value));
}

section("憑證重用：出生證明那 3–5 天只付一次");
{
  const before = getState().wallet.length;
  const pc = getState().wallet.find((c) => c.claimId === "parentChild.verified")!;
  check(
  "親子關係憑證的效期就是述詞定義的天數",
  Math.round((new Date(pc.expiresAt).getTime() - new Date(pc.issuedAt).getTime()) / 86_400_000) ===
    CLAIM_DEFS["parentChild.verified"].ttlDays,
);
  check("憑證發證簽章可獨立驗證", verifyCredential(pc));
  // Re-propose and redeem 甲 again: the parent-child credential must be reused.
  mutate((s) => proposeGrantsFromPlan(s, matchPrograms(sit)));
  signGrant({ grantId: jia, signature: sign(grantOf(jia).serialized, principal.secret), publicKey: pk });
  redeemGrant(jia, makeAgencyProof("jia", jia));
  check("第二次申請沒有重新發證", getState().wallet.length === before, `${before} → ${getState().wallet.length}`);
  check("憑證出示次數累加", getState().wallet.find((c) => c.claimId === "parentChild.verified")!.presentedCount >= 2);
}

section("竄改：欄位與簽署內容必須一致");
{
  mutate((s) => proposeGrantsFromPlan(s, matchPrograms(sit)));
  signGrant({ grantId: jia, signature: sign(grantOf(jia).serialized, principal.secret), publicKey: pk });
  const sigBefore = grantOf(jia).signature;
  const serBefore = grantOf(jia).serialized;
  const yiInboxBefore = JSON.stringify(getState().inboxes.yi.claims);
  // Repoint the fields every downstream check reads, leaving the signed bytes alone.
  mutate((s) => {
    const g = s.grants.find((x) => x.id === jia)!;
    g.body.aud = "yi";
    g.body.claims = ["power.usageBand"];
    g.body.cnf = { jkt: "" };
  });
  check("簽章與待簽 bytes 都沒被動過", grantOf(jia).signature === sigBefore && grantOf(jia).serialized === serBefore);
  const r = redeemGrant(jia, makeAgencyProof("yi", jia));
  check("改了 body 卻沒改簽章 → BAD_SIGNATURE", !r.result.ok && r.result.code === "BAD_SIGNATURE", JSON.stringify(r.result));
  check("乙的收件匣沒有因此改變", JSON.stringify(getState().inboxes.yi.claims) === yiInboxBefore);
}

section("竄改：憑證的值必須是發證機構簽過的值");
{
  resetState();
  registerPrincipalKey({ publicKey: pk, method: "software" });
  mutate((s) => proposeGrantsFromPlan(s, matchPrograms(sit)));
  signGrant({ grantId: yi, signature: sign(grantOf(yi).serialized, principal.secret), publicKey: pk });
  redeemGrant(yi, makeAgencyProof("yi", yi));
  mutate((s) => {
    s.wallet.find((c) => c.claimId === "power.usageBand")!.value = "NT$ 720,000";
  });
  const poisoned = getState().wallet.find((c) => c.claimId === "power.usageBand")!;
  check("換掉值之後憑證驗證失敗", !verifyCredential(poisoned));
  mutate((s) => {
    const g = s.grants.find((x) => x.id === yi)!;
    g.status = "signed";
    s.usedJti = [];
  });
  const r = redeemGrant(yi, makeAgencyProof("yi", yi));
  check("被污染的憑證無法交付", !r.result.ok && r.result.code === "MISSING_CREDENTIAL", JSON.stringify(r.result));
  check("所得沒有出現在任何收件匣", !JSON.stringify(getState().inboxes).includes("720,000"));
  resetState();
  registerPrincipalKey({ publicKey: pk, method: "software" });
  mutate((s) => proposeGrantsFromPlan(s, matchPrograms(sit)));
}

section("成對假名是有金鑰的");
{
  const unkeyed = `PP-${b64u(sha256(utf8(`grantonce/pairwise/yi/P-lin-demo`))).slice(0, 16)}`;
  check("不能用無金鑰的雜湊算出來", pairwiseId("P-lin-demo", "yi") !== unkeyed);
  check("兩個機關拿到的仍然不同", pairwiseId("P-lin-demo", "yi") !== pairwiseId("P-lin-demo", "jia"));
  const delivered = getState().inboxes.yi.claims.find((c) => c.claimId === "power.accountRef");
  check(
    "乙收到的就是這個函式算出來的假名",
    !delivered || delivered.value === pairwiseId(getState().principal.id, "yi"),
    delivered?.value,
  );
}

section("passkey 的來源限制");
{
  check("IP 位址不能當 RP ID", Boolean(originBlocker("127.0.0.1", true, "43127")));
  check("提示直接給出可用的網址", (originBlocker("127.0.0.1", true, "43127") ?? "").includes("localhost:43127"));
  check("IPv6 也擋", Boolean(originBlocker("[::1]", true, "43127")));
  check("localhost 可以用", originBlocker("localhost", true, "43127") === null);
  check("一般網域可以用", originBlocker("grantonce.example.tw", true, "443") === null);
  check("非安全脈絡不能用", Boolean(originBlocker("grantonce.example.tw", false, "80")));
}

section("畫面上的時間在伺服器與瀏覽器算出同一個字串");
{
  // These strings are rendered during SSR and again on hydration. `toLocaleString`
  // used to put U+2009 THIN SPACE between date and time on Node and U+0020 in
  // Chromium, so React tore the tree down on every page load and `next dev` lit
  // up a red issue badge next to the agent's input box. Any separator the
  // formatter did not choose itself is the bug coming back.
  const iso = "2026-08-29T16:04:01.000Z";
  const rendered = [formatClock(iso), formatTime(iso), formatDate(iso)];
  check(
    "只用 ASCII，沒有 locale 自帶的特殊空白",
    rendered.every((text) => /^[\x20-\x7E]+$/.test(text)),
    rendered.map((t) => [...t].map((c) => c.codePointAt(0)!.toString(16)).join(" ")).join(" | "),
  );
  // Pinned to Asia/Taipei, so the container's zone cannot change what is shown.
  check("時區固定在台北，不跟著執行環境跑", formatClock(iso) === "08/30 00:04:01", formatClock(iso));
  check("午夜是 00 不是 24", formatTime(iso) === "00:04:01", formatTime(iso));
  check("日期不帶前導零", formatDate(iso) === "2026/8/30", formatDate(iso));
}

section("邊界輸入");
{
  const bad = assessRisk({
    purpose: "aircon-subsidy",
    claims: ["power.accountRef"],
    delegation: { ...getState().delegation, maxSensitivity: "banana" as never },
    recentAudit: [],
    now: new Date(),
  });
  check("無法辨識的委託上限 → fail closed", bad.level === "blocked", JSON.stringify(bad.notes));
  check("原型鏈上的鍵不算合法述詞", !isClaimId("constructor") && !isClaimId("__proto__"));
  check("原型鏈上的鍵不算合法目的", !isPurposeId("toString") && !isPurposeId("__proto__"));
  check("原型鏈上的鍵不算已掛目的", !isLivePurposeId("toString") && !isLivePurposeId("valueOf"));
}

section("登記台");
{
  const invented = validatePurposeDraft({
    id: "flood-relief",
    title: "水災災害救助",
    agency: "jia",
    legalBasis: ["個人資料保護法 §15 第 1 款：執行法定職務必要範圍"],
    allowedClaims: ["disaster.floodVictim"],
    maxTtlSeconds: 600,
    necessity: "核定災害救助需要受災事實，但本 runtime 還沒有這項述詞。",
  });
  check("不能發明 disaster.* 述詞", Boolean(invented.error), invented.error);
  check("發明述詞的錯誤指向 adapter", Boolean(invented.error?.includes("adapter")), invented.error);

  const proto = validatePurposeDraft({
    id: "toString",
    title: "偽造目的",
    agency: "jia",
    legalBasis: ["個人資料保護法 §15"],
    allowedClaims: ["resident.inNewTaipei"],
    maxTtlSeconds: 600,
    necessity: "這不應該被當成合法目的寫進登記表。",
  });
  check("toString 不能當目的 ID", Boolean(proto.error));

  const hung = upsertPurpose({
    id: "move-bonus",
    title: "遷入獎勵",
    agency: "jia",
    legalBasis: ["個人資料保護法 §15 第 1 款：執行法定職務必要範圍"],
    allowedClaims: ["resident.inNewTaipei", "resident.movedWithin12m"],
    maxTtlSeconds: 600,
    necessity: "只要確認設籍本市與一年內遷入，不需要地址本身。",
  });
  check("既有述詞可以掛上新目的", !hung.error && isLivePurposeId("move-bonus"), hung.error);
  check("委託範圍跟著掛上的目的打開", getState().delegation.purposes.includes("move-bonus"));

  const hungRisk = assessRisk({
    purpose: "move-bonus",
    claims: ["resident.inNewTaipei", "resident.movedWithin12m"],
    delegation: getState().delegation,
    recentAudit: [],
    now: new Date(),
    purposes: purposesFrom(getState()),
  });
  check("掛上的目的可以用既有述詞通過風險檢查", hungRisk.level === "low", JSON.stringify(hungRisk));

  const unknown = assessRisk({
    purpose: "not-registered",
    claims: ["resident.inNewTaipei"],
    delegation: getState().delegation,
    recentAudit: [],
    now: new Date(),
    purposes: purposesFrom(getState()),
  });
  check("未掛目的直接攔截", unknown.level === "blocked");

  const retired = retirePurpose("move-bonus");
  check("下架後不再是已掛目的", !retired.error && !isLivePurposeId("move-bonus"), retired.error);
  check("下架後委託範圍拿掉該目的", !getState().delegation.purposes.includes("move-bonus"));
}

section("每一道防線各自都擋得住");
{
  // Each case below signs a capsule that is valid in every respect except the
  // one under test, so exactly one check is doing the work.
  freshProposal();
  resign(jia, (b) => {
    b.cnf = { jkt: AGENCY_KEYS.yi.jkt };
  });
  const bound = redeemGrant(jia, makeAgencyProof("jia", jia));
  check("匣綁到別人的金鑰 → KEY_NOT_BOUND", !bound.result.ok && bound.result.code === "KEY_NOT_BOUND", JSON.stringify(bound.result));

  freshProposal();
  resign(jia, () => {});
  mutate((s) => {
    // A signature that is well-formed but over different bytes.
    s.grants.find((x) => x.id === jia)!.signature = sign("別的內容", principal.secret);
  });
  const sig = redeemGrant(jia, makeAgencyProof("jia", jia));
  check("兌現時仍會驗委託人簽章 → BAD_SIGNATURE", !sig.result.ok && sig.result.code === "BAD_SIGNATURE", JSON.stringify(sig.result));

  freshProposal();
  resign(jia, (b) => {
    b.exp = new Date(Date.now() - 60_000).toISOString();
  });
  const exp = redeemGrant(jia, makeAgencyProof("jia", jia));
  check("簽得好好的但已逾期 → EXPIRED", !exp.result.ok && exp.result.code === "EXPIRED", JSON.stringify(exp.result));

  freshProposal();
  resign(jia, (b) => {
    // The principal really did sign this. The registry refuses anyway.
    b.claims = [...b.claims, "raw.income.annual"];
  });
  const scope = redeemGrant(jia, makeAgencyProof("jia", jia));
  check("委託人簽了超範圍的述詞 → OUTSIDE_PURPOSE", !scope.result.ok && scope.result.code === "OUTSIDE_PURPOSE", JSON.stringify(scope.result));
  check("超範圍時不交付任何欄位", getState().inboxes.jia.claims.every((c) => c.claimId !== "raw.income.annual"));

  freshProposal();
  resign(yi, () => {});
  mutate((s) => {
    // Stop the delegation without the cascade, so only this check can catch it.
    s.delegation.active = false;
  });
  const deleg = redeemGrant(yi, makeAgencyProof("yi", yi));
  check("委託停用但匣仍有效 → NO_DELEGATION", !deleg.result.ok && deleg.result.code === "NO_DELEGATION", JSON.stringify(deleg.result));
  mutate((s) => {
    s.delegation.active = true;
  });

  freshProposal();
  resign(yi, () => {});
  mutate((s) => {
    s.delegation.maxSensitivity = "predicate";
  });
  const risky = redeemGrant(yi, makeAgencyProof("yi", yi));
  check("兌現當下超過委託上限 → RISK_BLOCKED", !risky.result.ok && risky.result.code === "RISK_BLOCKED", JSON.stringify(risky.result));
  mutate((s) => {
    s.delegation.maxSensitivity = "pseudonym";
  });
  freshProposal();
}

section("Codex 找到的四個缺口");
{
  // The proof must be for this capsule, not merely for a grant id that gets reused.
  freshProposal();
  resign(jia, () => {});
  const stolen = makeAgencyProof("jia", jia);
  freshProposal();
  resign(jia, () => {});
  const replayed = redeemGrant(jia, stolen);
  check(
    "舊的機關持有證明不能用在新的同編號匣",
    !replayed.result.ok && replayed.result.code === "BAD_AGENCY_PROOF",
    JSON.stringify(replayed.result),
  );

  // Screening has to consider who is asking, not only which purpose they name.
  const wrongAgency = requestClaims("yi", "childcare-allowance", ["resident.inNewTaipei"]);
  check("乙用甲的目的索取述詞 → 攔截", wrongAgency.blocked, wrongAgency.notes.join(" | "));
  check(
    "理由指出這不是該機關的法定職務",
    wrongAgency.notes.some((n) => n.includes("法定職務")),
    wrongAgency.notes.join(" | "),
  );

  // A failed redemption must not leave a freshly issued credential behind.
  freshProposal();
  resign(yi, () => {});
  redeemGrant(yi, makeAgencyProof("yi", yi));
  mutate((s) => {
    // One credential is corrupt, another is missing entirely — so a redemption
    // that issues before validating would read the vault and mint the missing
    // one on its way to failing.
    s.wallet.find((c) => c.claimId === "power.usageBand")!.value = "竄改";
    s.wallet = s.wallet.filter((c) => c.claimId !== "power.accountRef");
  });
  const walletSize = getState().wallet.length;
  freshProposal();
  resign(yi, () => {});
  const failed = redeemGrant(yi, makeAgencyProof("yi", yi));
  check("憑證壞掉時兌現失敗", !failed.result.ok, JSON.stringify(failed.result));
  check(
    "失敗的兌現沒有先發證",
    getState().wallet.length === walletSize,
    `${walletSize} → ${getState().wallet.length}`,
  );

  // A second application must be submittable; the inbox used to inherit submittedAt.
  resetState();
  registerPrincipalKey({ publicKey: pk, method: "software" });
  for (const round of [1, 2]) {
    freshProposal();
    resign(jia, () => {});
    redeemGrant(jia, makeAgencyProof("jia", jia));
    check(`第 ${round} 次申請都送得出去`, !submitApplication(jia).error, `round ${round}`);
  }
}

section("特種個資是獨立的一道，不是靠其他檢查順便擋掉");
{
  // Give the delegation the widest ceiling and a purpose that would allow the
  // claim, so neither the ceiling nor the registry can mask this.
  const verdict = assessRisk({
    purpose: "childcare-allowance",
    claims: ["raw.income.annual"],
    delegation: { ...getState().delegation, maxSensitivity: "special" },
    recentAudit: [],
    now: new Date(),
  });
  check("仍然攔截", verdict.level === "blocked");
  check(
    "理由明確指出特種／敏感個資，且不是來自委託上限那條",
    verdict.notes.some((n) => n.includes("特種") && !n.includes("委託設定")),
    verdict.notes.join(" | "),
  );
  check("所得被列進 blockedClaims", verdict.blockedClaims.includes("raw.income.annual"));
}

section("高風險攔截");
{
  const r = requestClaims("jia", "childcare-allowance", ["raw.income.annual", "raw.household.address"]);
  check("機關索取所得 → 提案即攔截", r.blocked);
  check("攔截理由指出法定職務範圍", r.notes.some((n) => n.includes("§15")), r.notes.join("|"));
  check("攔截理由指出特種個資", r.notes.some((n) => n.includes("特種")));
}
{
  const r = requestClaims("yi", "aircon-subsidy", ["raw.household.householdId"]);
  check("乙索取戶號 → 攔截", r.blocked);
}

section("撤銷");
{
  mutate((s) => proposeGrantsFromPlan(s, matchPrograms(sit)));
  signGrant({ grantId: yi, signature: sign(grantOf(yi).serialized, principal.secret), publicKey: pk });
  revokeGrant(yi, "測試撤銷");
  const r = redeemGrant(yi, makeAgencyProof("yi", yi));
  check("撤銷後兌現 → REVOKED", !r.result.ok && r.result.code === "REVOKED", JSON.stringify(r.result));
}
{
  mutate((s) => proposeGrantsFromPlan(s, matchPrograms(sit)));
  revokeDelegation("委託人停止委託");
  check("停止委託後所有未兌現的匣作廢", getState().grants.every((x) => x.status !== "proposed" && x.status !== "signed"));
  const r = redeemGrant(jia, makeAgencyProof("jia", jia));
  check("停止委託後兌現 → 擋下", !r.result.ok, JSON.stringify(r.result));
  restoreDelegation();
}

section("委託上限");
{
  updateDelegation({ maxSensitivity: "predicate" });
  const r = requestClaims("yi", "aircon-subsidy", ["power.accountRef"]);
  check("假名超過委託上限 → 攔截", r.blocked, r.notes.join("|"));
  updateDelegation({ maxSensitivity: "pseudonym" });
}

section("送件");
{
  mutate((s) => proposeGrantsFromPlan(s, matchPrograms(sit)));
  signGrant({ grantId: jia, signature: sign(grantOf(jia).serialized, principal.secret), publicKey: pk });
  redeemGrant(jia, makeAgencyProof("jia", jia));
  check("送件成功", !submitApplication(jia).error);
  check("重複送件被擋", Boolean(submitApplication(jia).error));
}

section("逾期");
{
  mutate((s) => proposeGrantsFromPlan(s, matchPrograms(sit)));
  mutate((s) => {
    const g = s.grants.find((x) => x.id === yi)!;
    g.body.exp = new Date(Date.now() - 1000).toISOString();
    g.serialized = serializeBody(g.body);
  });
  const stale = grantOf(yi);
  check("逾期的匣不能簽署", Boolean(signGrant({ grantId: yi, signature: sign(stale.serialized, principal.secret), publicKey: pk }).error));
  check("狀態被標記為 expired", grantOf(yi).status === "expired");
  const r = redeemGrant(yi, makeAgencyProof("yi", yi));
  check("逾期的匣兌現 → EXPIRED（不是 UNSIGNED）", !r.result.ok && r.result.code === "EXPIRED", JSON.stringify(r.result));
  check("逾期的匣不需要再撤銷", Boolean(revokeGrant(yi, "測試").error));
  mutate((s) => proposeGrantsFromPlan(s, matchPrograms(sit)));
}

section("動態授權：時間前進");
{
  mutate((s) => { s.clockOffsetDays = 400; });
  const changes = scanForChanges(getState(), new Date());
  check("偵測到幼兒滿 2 歲", changes.some((c) => c.kind === "eligibility-change"), JSON.stringify(changes));
  const later = situationFromUtterance("我剛搬家，看我能申請什麼。", effectiveToday(getState()))!;
  check("重新比對後育兒津貼不再成立", !matchPrograms(later).some((p) => p.grantId === "G-甲"));
  mutate((s) => { s.clockOffsetDays = 0; });
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("failed:", failures.join(", "));
  process.exit(1);
}
