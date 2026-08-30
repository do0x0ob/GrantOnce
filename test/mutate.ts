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
    find: "    if (PURPOSES[purpose].agency !== agency) {",
    replace: "    if (false) {",
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
    label: "述詞換回原始欄位",
    file: "lib/purposes.ts",
    find: '      "parentChild.verified",',
    replace: '      "raw.child.name",',
  },
];

const SUITES = [
  { name: "flow", file: "test/flow.ts" },
  { name: "mcp", file: "mcp/test.ts" },
  { name: "race", file: "test/race.ts" },
];

function runSuites(): { name: string; ok: boolean; firstFailure: string }[] {
  return SUITES.map(({ name, file }) => {
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
  });
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
    const caught = runSuites().filter((r) => !r.ok);
    if (caught.length) {
      console.log(`  抓到  ${mutation.label}  →  ${caught.map((c) => c.name).join(",")}`);
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
