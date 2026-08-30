/**
 * Mutation harness. Disables one defence at a time and requires that some suite
 * goes red.
 *
 * A green suite proves nothing on its own: several assertions here used to pass
 * because a *different* check was doing the work, so removing the one they named
 * changed nothing. This is what keeps the tests honest as the code moves.
 *
 *   npm run test:mutate
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const ROOT = resolve(process.cwd());

type Mutation = { label: string; file: string; find: string; replace: string };

/** Each entry removes exactly one guarantee the suites claim to cover. */
const MUTATIONS: Mutation[] = [
  {
    label: "序列化不涵蓋巢狀 cnf",
    file: "lib/crypto.ts",
    find: "return JSON.stringify(sortDeep(body));",
    replace: "return JSON.stringify(body, Object.keys(body as object).sort());",
  },
  {
    label: "body 與簽署內容不再比對",
    file: "lib/authz.ts",
    find: "  return serializeBody(grant.body) === grant.serialized;",
    replace: "  return true;",
  },
  {
    label: "憑證的值不再對照簽章",
    file: "lib/wallet.ts",
    find: "    signed.val === cred.value &&",
    replace: "    true &&",
  },
  {
    label: "不檢查受眾 aud",
    file: "lib/authz.ts",
    find: "    if (grant.body.aud !== claimer) {",
    replace: "    if (false) {",
  },
  {
    label: "不檢查金鑰指紋 cnf.jkt",
    file: "lib/authz.ts",
    find: "    if (thumbprint(AGENCY_KEYS[claimer].publicKey) !== grant.body.cnf.jkt) {",
    replace: "    if (false) {",
  },
  {
    label: "不驗機關持有證明",
    file: "lib/authz.ts",
    find: "    if (!verifyAgencyProof(proof, grant)) {",
    replace: "    if (false) {",
  },
  {
    label: "不驗委託人簽章",
    file: "lib/authz.ts",
    find: "    if (!verify(grant.signature, grant.serialized, unb64u(grant.signedByKey))) {",
    replace: "    if (false) {",
  },
  {
    label: "jti 不燒掉（可重放）",
    file: "lib/authz.ts",
    find: "    s.usedJti.push(grant.body.jti);",
    replace: "    void grant.body.jti;",
  },
  {
    label: "不檢查效期",
    file: "lib/authz.ts",
    find: "    if (new Date(grant.body.exp).getTime() < now.getTime()) {",
    replace: "    if (false) {",
  },
  {
    label: "不檢查目的範圍",
    file: "lib/authz.ts",
    find: "    if (outside.length) {",
    replace: "    if (false) {",
  },
  {
    label: "停止委託後仍可兌現",
    file: "lib/authz.ts",
    find: "    if (!s.delegation.active) {",
    replace: "    if (false) {",
  },
  {
    label: "風險攔截失效",
    file: "lib/authz.ts",
    find: '    if (risk.level === "blocked") {',
    replace: "    if (false) {",
  },
  {
    label: "不得授權的欄位不再攔截",
    file: "lib/risk.ts",
    find: "  if (withheld.length) {",
    replace: "  if (false) {",
  },
  {
    label: "假名回到無金鑰雜湊",
    file: "lib/crypto.ts",
    find: "  const mac = hmac(sha256, PAIRWISE_SECRET, utf8(`${audience}\\u0000${subject}`));",
    replace: "  const mac = sha256(utf8(`grantonce/pairwise/${audience}/${subject}`));",
  },
  {
    label: "跨 process 不上鎖",
    file: "lib/store.ts",
    find: "  return withLock(() => {",
    replace: "  return ((run: () => DemoState) => run())(() => {",
  },
  {
    label: "舊版 store 不再拒絕",
    file: "lib/store.ts",
    find: "      if (!isCurrentSchema(parsed)) {",
    replace: "      if (false) {",
  },
  {
    label: "機關持有證明不綁匣的摘要",
    file: "lib/authz.ts",
    find: "  if (proof.digest !== grant.digest) return false;",
    replace: "  if (false) return false;",
  },
  {
    label: "索取時不看是誰在問",
    file: "lib/authz.ts",
    // Keep the unregistered-purpose guard and drop only the requester check, so
    // what the mutation removes is exactly the property under test.
    find: "    if (!live || live.agency !== agency) {",
    replace: "    if (!live) {",
  },
  {
    label: "先發證再驗憑證",
    file: "lib/authz.ts",
    find: "    if (staleCredential) {",
    replace: "    if (false) {",
  },
  {
    label: "收件匣沿用上次的送件時間",
    file: "lib/authz.ts",
    find: "      submittedAt: null,\n      lastDenial: null,",
    replace: "      lastDenial: null,",
  },
  {
    label: "IP 位址也當成可用的 passkey 來源",
    file: "lib/passkey.ts",
    find: "  if (isIpv4 || isIpv6) {",
    replace: "  if (false) {",
  },
  {
    label: "matcher 讀原型鏈上的屬性",
    file: "lib/agent/blocks/of.ts",
    find: "  return Object.fromEntries(Object.entries(o as Obj));",
    replace: "  return o as Obj;",
  },
  {
    label: "指名一項補助卻連別的一起給",
    file: "lib/agent/turn.ts",
    find: "  const programs = narrowed",
    replace: "  const programs = false",
  },
  {
    label: "資格比對改回看你怎麼講而不是看事實",
    file: "lib/rules.ts",
    find: '  if (situation.wantsChildcare && band === "0-2") {',
    replace: '  if (situation.wantsChildcare && situation.movedRecently && band === "0-2") {',
  },
  {
    label: "拒絕理由改回講遷徙",
    file: "lib/inquiry.ts",
    find: "    return `本 runtime 有對得上的可發票目的，但這個人目前不符合它的資格條件。${ageHint(",
    replace: '    return "本 runtime 有對得上的可發票目的，但這句話還沒對上資格條件（育兒津貼需要聲明遷徙）。模型不能改條件。"; // eslint-disable-line\n    return `x${(',
  },
  {
    label: "模型可以宣稱動作已經完成",
    file: "lib/agent/intent.ts",
    find: "  if (FORBIDDEN.test(text)) return undefined;",
    replace: "  if (false) return undefined;",
  },
  {
    // "Cards carry ids, not snapshots" is enforced by the Block union itself, so
    // no single-file edit can violate it — that one is guarded by the compiler.
    // This checks the other half: unrecognised output must be dropped, not
    // forced into a text card where junk would render as if it were a reply.
    label: "認不得的輸出被硬塞成文字卡",
    file: "lib/agent/blocks/of.ts",
    find: "    // Unrecognised output is dropped rather than forced into a card.",
    replace: '    out.push({ kind: "text", text: JSON.stringify(o) });',
  },
  {
    label: "聽不懂時不給下一步",
    file: "lib/agent/turn.ts",
    find: '        { question: "你可以問我這些", suggestions: MENU.suggestions },',
    replace: "        { text: \"我聽不懂。\" },",
  },
  {
    label: "把所得說成 §6 特種個資（法律誤植）",
    file: "lib/claims.ts",
    find: '      "非 §6 特種個資，但依 §5 比例原則由本設計自行排除：這些補助的核定不需要所得",',
    replace: '      "個資法 §6 第 1 項特種個資，法律禁止",',
  },
  {
    label: "同意畫面不再引個資依據",
    file: "lib/authz.ts",
    find: '    `個資依據：${def.privacyBasis.join("；")}`,',
    replace: '    "個資依據：（略）",',
  },
  {
    label: "匣編號改回硬編",
    file: "lib/purposes.ts",
    find: "  const purpose = purposeOfSlot(raw);\n  return purpose ? PURPOSES[purpose].slot : null;",
    replace: '  const t = raw.trim();\n  return t === "G-甲" || t === "G-jia" ? "G-甲" : t === "G-乙" || t === "G-yi" ? "G-乙" : null;',
  },
  {
    label: "述詞從凍結的日期推導",
    file: "lib/claims.ts",
    find: "    compute: ({ today }) => ageBandOf(childAgeMonths(today)),",
    replace: "    compute: () => ageBandOf(childAgeMonths()),",
  },
  {
    label: "憑證效期不跟著演示時鐘",
    file: "lib/authz.ts",
    find: "    const credentialNow = effectiveNow(s);",
    replace: "    const credentialNow = now;",
  },
  {
    // Only builtins get an inbox at reset, so a purpose hung on the registry
    // desk must have one made on first touch.
    label: "登記台掛上的目的沒有自己的收件匣",
    file: "lib/authz.ts",
    find: "  const existing = state.inboxes[purpose];\n  if (existing) return existing;",
    replace: "  const existing = state.inboxes[purpose];\n  if (!existing) return {} as AgencyInbox;",
  },
  {
    // The beat this whole split exists for: discovery must not mint.
    label: "比對完就直接鑄匣（需求與授權又黏回去）",
    file: "lib/agent/turn.ts",
    find: "  for (const program of programs) {\n    outputs.push({ serviceRequirement: program.purpose });\n  }",
    replace: "  for (const program of programs) {\n    outputs.push({ serviceRequirement: program.purpose });\n    outputs.push({ grantId: program.grantId });\n  }",
  },
  {
    // Confirming names one thing. Falling back to 「唯一還開著的那項」 after
    // something was named hands over a capsule nobody asked for.
    label: "指名已簽掉的那項，就順手確認別的",
    file: "lib/agent/turn.ts",
    find: "      : mentioned.length\n        ? []",
    replace: "      : mentioned.length\n        ? pending",
  },
  {
    // A word must not be enough to mint. Without the state gate, 「確認」 with
    // nothing open falls through and starts a proposal on its own.
    label: "沒有待確認的需求也照樣往下走",
    file: "lib/agent/turn.ts",
    find: '  const pending = state.serviceRequests.filter((r) => r.status === "awaiting-confirmation");',
    replace: "  const pending = state.serviceRequests;",
  },
  {
    // The registry and 個資法 check belongs after the person agrees, and its
    // result is what the card shows.
    label: "確認後不再記錄檢查結果",
    file: "lib/authz.ts",
    find: "  request.checkNotes = [...fresh.riskNotes];",
    replace: "  request.checkNotes = [];",
  },
  {
    label: "述詞換回原始欄位",
    file: "lib/purposes.ts",
    find: '      "parentChild.verified",',
    replace: '      "raw.child.name",',
  },
  {
    label: "同意文字宣稱的件數與實際述詞不符",
    file: "lib/purposes.ts",
    find: "「設籍本市」「一年內遷入」「具法定親子關係」「幼兒落在 0–2 歲」四件事",
    replace: "「設籍本市」「具法定親子關係」「幼兒落在 0–2 歲」三件事",
  },
  {
    label: "推播去重從 key 改回 title",
    file: "lib/agent.ts",
    find: "    if (state.notifications.some((n) => n.key === change.key)) continue;",
    replace: "    if (state.notifications.some((n) => n.title === change.title)) continue;",
  },
  {
    label: "get_notifications 回傳人類版本的 body",
    file: "mcp/tools.ts",
    find: "    summary: n.summaryForAgent,",
    replace: "    summary: n.body,",
  },
  {
    label: "不再檢查述詞值有沒有外洩",
    file: "mcp/tools.ts",
    find: "  assertNoClaimValueLeak(payload, where);",
    replace: "  void payload;",
  },
  {
    label: "推播的 key 不帶 jti（新匣被舊推播擋掉）",
    file: "lib/rules.ts",
    find: "        key: `awaiting-sign:${grant.id}:${grant.body.jti}`,",
    replace: "        key: `awaiting-sign:${grant.id}`,",
  },
  {
    label: "巡檢不留下時間戳",
    file: "lib/agent.ts",
    find: "  state.lastTickAt = nowIso();",
    replace: "  void nowIso();",
  },
  {
    label: "時間格式交還給 locale（伺服器與瀏覽器會不一致）",
    file: "lib/view.ts",
    find: '  return `${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;',
    replace:
      '  return new Date(iso).toLocaleString("zh-TW", { ...YMD, ...HMS, hour12: false, timeZone: TAIPEI });',
  },
];

/**
 * Cheapest first, and `race` last: it spawns a dozen subprocesses, so running it
 * for a mutation three earlier suites already caught is most of the wall clock
 * for none of the information.
 */
const SUITES = [
  { name: "flow", file: "test/flow.ts" },
  { name: "agent", file: "test/agent.ts" },
  { name: "mcp", file: "mcp/test.ts" },
  { name: "race", file: "test/race.ts" },
];

function runSuite(name: string, file: string): { name: string; ok: boolean; firstFailure: string } {
  const store = `/tmp/grantonce-mutate-${name}-${randomBytes(4).toString("hex")}.json`;
  try {
    execFileSync("npx", ["tsx", file], {
      cwd: ROOT,
      env: { ...process.env, GRANTONCE_STORE: store },
      encoding: "utf8",
      stdio: "pipe",
    });
    return { name, ok: true, firstFailure: "" };
  } catch (error) {
    const out = String((error as { stdout?: string }).stdout ?? "");
    const line = out.split("\n").find((l) => l.includes("FAIL")) ?? "";
    return { name, ok: false, firstFailure: line.trim().slice(0, 90) };
  }
}

/** Every suite. Used once, to prove the baseline is green. */
function runSuites() {
  return SUITES.map(({ name, file }) => runSuite(name, file));
}

/**
 * Stops at the first red. A mutation is either caught or it is not; which
 * *other* suites would also have caught it costs minutes and answers nothing.
 */
function firstCatch(): { name: string; firstFailure: string } | null {
  for (const { name, file } of SUITES) {
    const result = runSuite(name, file);
    if (!result.ok) return { name, firstFailure: result.firstFailure };
  }
  return null;
}

const baseline = runSuites();
if (baseline.some((r) => !r.ok)) {
  console.error("基準線就是紅的，先修好測試再跑 mutation：");
  for (const r of baseline.filter((x) => !x.ok)) console.error(`  ${r.name}: ${r.firstFailure}`);
  process.exit(1);
}

const missed: string[] = [];
for (const mutation of MUTATIONS) {
  const path = join(ROOT, mutation.file);
  const original = readFileSync(path, "utf8");
  if (!original.includes(mutation.find)) {
    console.log(`  ???  ${mutation.label}（在 ${mutation.file} 找不到對應程式碼，可能已重構）`);
    missed.push(`${mutation.label}（錨點失效）`);
    continue;
  }
  writeFileSync(path, original.replace(mutation.find, mutation.replace), "utf8");
  try {
    const caught = firstCatch();
    if (caught) {
      console.log(`  抓到  ${mutation.label}  →  ${caught.name}`);
    } else {
      console.log(`  漏掉  ${mutation.label}`);
      missed.push(mutation.label);
    }
  } finally {
    writeFileSync(path, original, "utf8");
  }
}

console.log(`\n${MUTATIONS.length - missed.length}/${MUTATIONS.length} 個被抓到`);
if (missed.length) {
  console.log("沒有任何測試會失敗：");
  for (const m of missed) console.log(`  - ${m}`);
  process.exit(1);
}
