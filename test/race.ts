/**
 * Cross-process check. The web app and the MCP server share one store, so the
 * one-time guarantee has to survive two writers — this spawns real concurrent
 * processes rather than simulating concurrency inside one event loop.
 *
 *   npm run test:race
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const LIB = join(ROOT, "lib");
const dir = mkdtempSync(join(tmpdir(), "grantonce-race-"));
const env = { ...process.env, GRANTONCE_STORE: join(dir, "store.json") };

function script(name: string, body: string): string {
  const file = join(dir, `${name}.ts`);
  writeFileSync(file, body, "utf8");
  return file;
}

function run(file: string, args: string[] = []): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn("npx", ["tsx", file, ...args], { env, cwd: ROOT });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) =>
      code === 0 ? done(out.trim()) : fail(new Error(`${file} exited ${code}\n${err}`)),
    );
  });
}

const setup = script(
  "setup",
  `
import { keyPairFromSeed, sign, b64u } from "${LIB}/crypto";
import { proposeGrantsFromPlan, registerPrincipalKey, signGrant } from "${LIB}/authz";
import { matchPrograms, situationFromUtterance } from "${LIB}/rules";
import { getState, mutate, resetState } from "${LIB}/store";
resetState();
const p = keyPairFromSeed("race-principal");
registerPrincipalKey({ publicKey: b64u(p.publicKey), method: "software" });
mutate((s) => proposeGrantsFromPlan(s, matchPrograms(situationFromUtterance("我剛搬家，看我能申請什麼。")!)));
const g = getState().grants.find((x) => x.id === "G-甲")!;
signGrant({ grantId: "G-甲", signature: sign(g.serialized, p.secret), publicKey: b64u(p.publicKey) });
console.log("ready");
`,
);

const redeem = script(
  "redeem",
  `
import { makeAgencyProof, redeemGrant } from "${LIB}/authz";
const r = redeemGrant("G-甲", makeAgencyProof("jia", "G-甲"));
console.log(r.result.ok ? "REDEEMED" : "REFUSED");
`,
);

const audit = script(
  "audit",
  `
import { appendAudit, mutate } from "${LIB}/store";
mutate((s) => appendAudit(s, { actor: process.argv[2], actorRole: "system", action: "notify", detail: "race" }));
console.log("done");
`,
);

const readState = script(
  "readState",
  `
import { getState } from "${LIB}/store";
import { principalView } from "${LIB}/view";
const v = principalView(getState());
console.log(JSON.stringify({ grants: v.grants.length, audit: v.audit.length }));
`,
);

const inspect = script(
  "inspect",
  `
import { getState } from "${LIB}/store";
const s = getState();
console.log(JSON.stringify({
  usedJti: s.usedJti.length,
  redeems: s.audit.filter((a) => a.action === "redeem").length,
  entries: s.audit.filter((a) => a.detail === "race").map((a) => a.actor).sort(),
}));
`,
);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : " " + detail}`);
  if (!cond) failures += 1;
}

async function main() {
  console.log("六個 process 同時兌現同一張一次性的匣");
  await run(setup);
  const results = await Promise.all(Array.from({ length: 6 }, () => run(redeem)));
  const state = JSON.parse(await run(inspect)) as { usedJti: number; redeems: number };
  check("只有一個成功", results.filter((r) => r === "REDEEMED").length === 1, results.join(","));
  check("只燒掉一個 jti", state.usedJti === 1, String(state.usedJti));
  check("稽核只記一次兌現", state.redeems === 1, String(state.redeems));

  console.log("\n六個 process 各寫一筆稽核");
  await run(setup);
  const tags = ["A", "B", "C", "D", "E", "F"];
  await Promise.all(tags.map((t) => run(audit, [t])));
  const after = JSON.parse(await run(inspect)) as { entries: string[] };
  check("六筆都保留，沒有互相覆蓋", after.entries.join(",") === tags.join(","), after.entries.join(","));

  console.log("\n上一版 schema 的 store 檔");
  // A leftover /tmp/grantonce-runtime.json from an older build used to take the
  // whole app down on the first request. It must be rejected, not half-loaded.
  writeFileSync(
    env.GRANTONCE_STORE,
    JSON.stringify({
      principal: { id: "P-lin-demo", name: "林曉晴", summary: "x", synthetic: true },
      vaultCatalog: [],
      grants: [],
      envelopes: { "G-甲": { grantId: "G-甲", fields: {} } },
      audit: [],
      chat: [],
      agencies: {},
    }),
    "utf8",
  );
  const recovered = JSON.parse(await run(readState)) as { grants: number };
  check("不會崩潰，改用全新狀態啟動", recovered.grants === 0);
  check("壞掉的檔案被隔離保留", readdirSync(dirname(env.GRANTONCE_STORE)).some((f) => f.includes(".corrupt-")));
}

main()
  .catch((error) => {
    console.error(error);
    failures += 1;
  })
  .finally(() => {
    rmSync(dir, { recursive: true, force: true });
    console.log(failures ? `\n${failures} failed` : "\nall passed");
    if (failures) process.exit(1);
  });
