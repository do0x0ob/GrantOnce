/**
 * Cross-process check. The web app and the MCP server share one store, so the
 * one-time guarantee has to survive two writers — this spawns real concurrent
 * processes rather than simulating concurrency inside one event loop.
 *
 *   npm run test:race
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * A start barrier the children rendezvous on.
 *
 * Spawning six `npx tsx` processes and hoping they collide does not test
 * anything: boot dominates by a second or more and varies run to run, while the
 * critical section is a few file operations. The suite passed with the lock
 * removed roughly one run in three — so the mutation harness reported the lock
 * as untested, on the slide that invites judges to run it.
 *
 * Each child finishes importing and preparing, publishes a ready file, then
 * waits until every sibling has published one. They leave within a millisecond
 * of the last arrival — shorter than the critical section — and so enter it
 * together however long boot took.
 */
const BARRIER = `
import { readdirSync, writeFileSync } from "node:fs";
function barrier(dir: string, n: number) {
  const idle = new Int32Array(new SharedArrayBuffer(4));
  writeFileSync(\`\${dir}/\${process.pid}.ready\`, "", "utf8");
  const deadline = Date.now() + 60_000;
  while (readdirSync(dir).filter((f) => f.endsWith(".ready")).length < n) {
    if (Date.now() > deadline) throw new Error("barrier timed out");
    // Yield rather than spin. Six processes busy-waiting on a two-core CI
    // runner would starve the very boots this is waiting for. Polling every
    // millisecond still releases everyone inside one millisecond of the last
    // arrival, which is shorter than the critical section being tested.
    Atomics.wait(idle, 0, 0, 1);
  }
}
`;

/** Fresh rendezvous point per wave, so one wave's files do not release the next. */
function barrierDir(name: string): string {
  const path = join(dir, `barrier-${name}`);
  mkdirSync(path, { recursive: true });
  return path;
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
import { confirmServiceRequest, openServiceRequests, registerPrincipalKey, signGrant } from "${LIB}/authz";
import { matchPrograms, situationFromUtterance } from "${LIB}/rules";
import { getState, mutate, resetState } from "${LIB}/store";
resetState();
const p = keyPairFromSeed("race-principal");
registerPrincipalKey({ publicKey: b64u(p.publicKey), method: "software" });
mutate((s) => {
  for (const request of openServiceRequests(s, matchPrograms(situationFromUtterance("我剛搬家，看我能申請什麼。")!))) {
    confirmServiceRequest(s, request.id);
  }
});
const g = getState().grants.find((x) => x.id === "G-甲")!;
signGrant({ grantId: "G-甲", signature: sign(g.serialized, p.secret), publicKey: b64u(p.publicKey) });
console.log("ready");
`,
);

const redeem = script(
  "redeem",
  `${BARRIER}
import { makeAgencyProof, redeemGrant } from "${LIB}/authz";
// Everything that is not the critical section happens before the rendezvous.
const proof = makeAgencyProof("jia", "G-甲");
barrier(process.argv[2], Number(process.argv[3]));
const r = redeemGrant("G-甲", proof);
console.log(r.result.ok ? "REDEEMED" : "REFUSED");
`,
);

const audit = script(
  "audit",
  `${BARRIER}
import { appendAudit, mutate } from "${LIB}/store";
const actor = process.argv[2];
barrier(process.argv[3], Number(process.argv[4]));
mutate((s) => appendAudit(s, { actor, actorRole: "system", action: "notify", detail: "race" }));
console.log("done");
`,
);

/**
 * Two watch loops, one store. The web app and the MCP server both tick, so
 * "pushed once" has to survive them landing together — dedupe by key is a
 * check-then-act like every other, and without the lock both passes see an
 * empty outbox and both write.
 */
const tick = script(
  "tick",
  `${BARRIER}
import { runAgentTick } from "${LIB}/agent";
barrier(process.argv[2], Number(process.argv[3]));
console.log(String(runAgentTick().length));
`,
);

const ageOut = script(
  "ageOut",
  `
import { mutate } from "${LIB}/store";
mutate((s) => { s.clockOffsetDays = 400; s.notifications = []; s.lastTickAt = null; });
console.log("aged");
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
  notificationKeys: s.notifications.map((n) => n.key).sort(),
  lastTickAt: s.lastTickAt,
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
  const redeemGate = barrierDir("redeem");
  const results = await Promise.all(
    Array.from({ length: 6 }, () => run(redeem, [redeemGate, "6"])),
  );
  const state = JSON.parse(await run(inspect)) as { usedJti: number; redeems: number };
  check("只有一個成功", results.filter((r) => r === "REDEEMED").length === 1, results.join(","));
  check("只燒掉一個 jti", state.usedJti === 1, String(state.usedJti));
  check("稽核只記一次兌現", state.redeems === 1, String(state.redeems));

  console.log("\n六個 process 各寫一筆稽核");
  await run(setup);
  const tags = ["A", "B", "C", "D", "E", "F"];
  const auditGate = barrierDir("audit");
  await Promise.all(tags.map((t) => run(audit, [t, auditGate, String(tags.length)])));
  const after = JSON.parse(await run(inspect)) as { entries: string[] };
  check("六筆都保留，沒有互相覆蓋", after.entries.join(",") === tags.join(","), after.entries.join(","));

  console.log("\n六個 process 同時巡檢");
  await run(setup);
  await run(ageOut);
  const tickGate = barrierDir("tick");
  const pushedCounts = await Promise.all(
    Array.from({ length: 6 }, () => run(tick, [tickGate, "6"])),
  );
  const ticked = JSON.parse(await run(inspect)) as {
    notificationKeys: string[];
    lastTickAt: string | null;
  };
  const keys = ticked.notificationKeys;
  check("同一個 key 只產生一則推播", new Set(keys).size === keys.length, keys.join(","));
  check("條件確實有東西可推", keys.length > 0, keys.join(","));
  check(
    "只有一輪真的推出去，其他五輪什麼都沒推",
    pushedCounts.filter((n) => Number(n) > 0).length === 1,
    pushedCounts.join(","),
  );
  check("巡檢留下了時間戳", Boolean(ticked.lastTickAt));

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
