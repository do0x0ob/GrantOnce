/**
 * The agent's conversational surface.
 *
 * The vocabulary is finite because a rule engine decides eligibility, so these
 * assert what it actually understands and — more importantly — that an
 * unrecognised question still produces something the user can act on rather
 * than a dead end.
 */
import { toBlocks } from "../lib/agent/blocks/of";
import type { Block, BlockKind } from "../lib/agent/blocks/types";
import { runTurn } from "../lib/agent/turn";
import { proposeGrantsFromPlan } from "../lib/authz";
import { getState, mutate, resetState } from "../lib/store";

let pass = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name} ${detail}`);
  }
}
const kinds = (blocks: Block[]): BlockKind[] => blocks.map((b) => b.kind);
const ask = (q: string) => toBlocks(runTurn(getState(), q).outputs);

resetState();

console.log("聽得懂的問題各自產生對應的卡");
{
  const cases: [string, BlockKind][] = [
    ["機關會拿到我哪些資料？", "claimsExplainer"],
    ["誰拿過我的資料？", "auditTrail"],
    ["我要停止委託", "text"],
    ["你會做什麼", "suggestions"],
  ];
  for (const [q, expected] of cases) {
    check(`「${q}」→ ${expected}`, kinds(ask(q)).includes(expected), kinds(ask(q)).join(","));
  }
}

console.log("\n聽不懂的時候給得出下一步");
{
  for (const q of ["今天天氣如何", "asdfgh", "０"]) {
    const blocks = ask(q);
    check(`「${q}」不是死路`, kinds(blocks).includes("suggestions"), kinds(blocks).join(","));
    const suggestion = blocks.find((b) => b.kind === "suggestions");
    check(
      `「${q}」的建議都是它真的聽得懂的`,
      suggestion?.kind === "suggestions" &&
        suggestion.payload.options.every((o) => !kinds(ask(o.utterance)).includes("suggestions") ||
          kinds(ask(o.utterance)).length > 1),
      "",
    );
  }
}

console.log("\n比對成功時，每個申請案都有一張簽署卡與一張進度卡");
{
  const turn = runTurn(getState(), "我剛搬家，看我能申請什麼。");
  mutate((s) => proposeGrantsFromPlan(s, turn.programs));
  const blocks = toBlocks(turn.outputs);
  const signCards = blocks.filter((b) => b.kind === "signGrant");
  const statusCards = blocks.filter((b) => b.kind === "applicationStatus");
  check("簽署卡數量等於申請案數量", signCards.length === turn.programs.length, `${signCards.length} vs ${turn.programs.length}`);
  check("進度卡數量等於申請案數量", statusCards.length === turn.programs.length);
  check(
    "每張簽署卡都指向一張真的存在的匣",
    signCards.every((b) => b.kind === "signGrant" && getState().grants.some((g) => g.id === b.grantId)),
  );
  check("比對結果卡在簽署卡前面", kinds(blocks).indexOf("eligibility") < kinds(blocks).indexOf("signGrant"));
}

console.log("\n卡片只帶 id，不帶快照");
{
  // A grant carries plenty that a card must not snapshot; feed the matcher a
  // whole grant and require that only the id survives.
  const grant = getState().grants[0];
  const smuggled = toBlocks([{ ...grant.body, ...grant, grantId: grant.id }]);
  const signCard = smuggled.find((b) => b.kind === "signGrant");
  check(
    "簽署卡只留 grantId，其餘一律不帶",
    signCard?.kind === "signGrant" && Object.keys(signCard).sort().join(",") === "grantId,kind",
    JSON.stringify(signCard).slice(0, 140),
  );

  const blocks = toBlocks(runTurn(getState(), "我剛搬家，看我能申請什麼。").outputs);
  const blob = JSON.stringify(blocks);
  check("整串輸出不含任何金庫值", !/林小禾|板橋|HH-DEMO|720,000|TP-DEMO/.test(blob));
}

console.log("\nmatcher 永遠不丟例外");
{
  const junk: unknown[] = [null, undefined, 0, "", [], { grantId: 123 }, { purpose: "nope" },
    { suggestions: [{}] }, { reasons: "not-an-array" }, { __proto__: { text: "x" } }];
  let threw = false;
  try {
    toBlocks(junk);
  } catch {
    threw = true;
  }
  check("餵垃圾進去不會炸", !threw);
  check("認不得的東西不會硬塞成卡片", toBlocks(junk).length === 0, JSON.stringify(kinds(toBlocks(junk))));
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("failed:", failures.join(" | "));
  process.exit(1);
}
