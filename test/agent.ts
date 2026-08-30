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
import { cleanReply, modelAvailable, type Classification } from "../lib/agent/intent";
import { runTurn } from "../lib/agent/turn";
import { evaluateInquiry } from "../lib/inquiry";
import { effectiveToday } from "../lib/rules";
import { proposeGrantsFromPlan } from "../lib/authz";
import { PURPOSES } from "../lib/purposes";
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

/** What the understanding layer would report for the scripted lines. */
const HEARD: Record<string, Classification> = {
  "機關會拿到我哪些資料？": { intent: "privacy", movedRecently: false, asked: null },
  "誰拿過我的資料？": { intent: "audit", movedRecently: false, asked: null },
  "我要停止委託": { intent: "revoke", movedRecently: false, asked: null },
  "我的申請到哪了？": { intent: "status", movedRecently: false, asked: null },
  "你會做什麼": { intent: "help", movedRecently: false, asked: null },
  "我剛搬家，看我能申請什麼。": { intent: "apply", movedRecently: true, asked: null },
  "要搞育兒津貼": { intent: "apply", movedRecently: false, asked: ["childcare-allowance"] },
  "我要辦一個不存在的補助": { intent: "apply", movedRecently: false, asked: ["not-a-purpose"] },
};

const ask = (q: string, resolved: Classification | null = HEARD[q] ?? null) =>
  toBlocks(runTurn(getState(), q, { resolved }).outputs);
const heard = (q: string, resolved: Classification | null = HEARD[q] ?? null) =>
  runTurn(getState(), q, { resolved });

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
  const happy = heard("我剛搬家，看我能申請什麼。");
  mutate((s) => proposeGrantsFromPlan(s, happy.programs));
  const blocks = toBlocks(happy.outputs);
  const signCards = blocks.filter((b) => b.kind === "signGrant");
  const statusCards = blocks.filter((b) => b.kind === "applicationStatus");
  check("簽署卡數量等於申請案數量", signCards.length === happy.programs.length, `${signCards.length} vs ${happy.programs.length}`);
  check("進度卡數量等於申請案數量", statusCards.length === happy.programs.length);
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

console.log("\n指名一項補助時，不會多給別的");
{
  resetState();
  const all = heard("我剛搬家，看我能申請什麼。");
  check("沒指名時列出全部符合的", all.programs.length > 1, String(all.programs.length));

  const named = heard("要搞育兒津貼");
  check("指名育兒津貼只回一項", named.programs.length === 1, named.programs.map((p) => p.purpose).join(","));
  check("而且就是那一項", named.programs[0]?.purpose === "childcare-allowance");
  check(
    "會說出它沒有替你要的那些",
    toBlocks(named.outputs).some((b) => b.kind === "text" && b.text.includes("我就不會替你要")),
  );

  // Narrowing must never be able to add something the rule engine did not match.
  const bogus = heard("我要辦一個不存在的補助");
  check(
    "指名不存在的東西不會憑空生出匣",
    bogus.programs.every((p) => all.programs.some((a) => a.purpose === p.purpose)),
  );
}

console.log("\n拒絕的理由要講真正的原因");
{
  // The reason a matched purpose did not issue is a fact about this person.
  // Naming a precondition that is no longer one told someone whose child had
  // turned two that they needed to declare a move.

  // Aging out of 育兒津貼 is a handover, not a refusal: the same agency's
  // 托育補助 picks the child up on the other side of the 0–2 band.
  mutate((s) => {
    s.clockOffsetDays = 400;
  });
  const aged = evaluateInquiry("要搞育兒津貼", effectiveToday(getState()));
  check(
    "滿兩歲後接到托育補助",
    aged.programs.some((p) => p.purpose === "childcare-service-subsidy"),
    aged.programs.map((p) => p.purpose).join(",") || "（無）",
  );
  check("不再提育兒津貼", !aged.programs.some((p) => p.purpose === "childcare-allowance"));

  // Past every age band there is nothing to hand over to, and that is where the
  // refusal text has to be right.
  mutate((s) => {
    s.clockOffsetDays = 2000;
  });
  const outgrown = evaluateInquiry("要搞育兒津貼", effectiveToday(getState()));
  check("年齡帶都過了就不能發票", !outgrown.canIssue);
  check("理由講年齡，不講遷徙", Boolean(outgrown.closeReason?.includes("歲")), outgrown.closeReason ?? "");
  check(
    "不會再叫人去聲明遷徙",
    !outgrown.closeReason?.includes("聲明遷徙"),
    outgrown.closeReason ?? "",
  );
  mutate((s) => {
    s.clockOffsetDays = 0;
  });

  const named = evaluateInquiry("要搞育兒津貼", effectiveToday(getState()));
  check("年齡符合時直接可以發票", named.canIssue && named.closeReason === null);
}

console.log("\n模型寫的那句話擋得住什麼");
{
  // A demo shown to a government audience must not have its agent claim an
  // application was filed. Free prose will reach for those verbs eventually.
  const rejected = [
    "已經幫你送出申請了",
    "我已送件，等機關核准",
    "已完成簽署",
    "幫你申請好了",
    "已取得你的資料",
  ];
  for (const text of rejected) {
    check(`擋掉「${text}」`, cleanReply(text) === undefined);
  }

  const kept = ["你的擔心很合理，所得正是我們刻意不給的欄位之一。", "我來看看你符合哪些補助。"];
  for (const text of kept) {
    check(`保留「${text.slice(0, 12)}…」`, cleanReply(text) === text);
  }

  check("太長的整句丟掉", cleanReply("字".repeat(61)) === undefined);
  check("空白的丟掉", cleanReply("   ") === undefined);
  check("不是字串的丟掉", cleanReply({ text: "x" }) === undefined && cleanReply(null) === undefined);
}

console.log("\n模型只當「聽懂」那一層");
{
  // The classifier's output must be able to change which intent runs, and
  // nothing else. Claim it says "apply" for a sentence the patterns would not
  // match, and the rule engine still governs what gets asked for.
  const forced = runTurn(getState(), "隨便講一句不相干的話", {
    today: effectiveToday(getState()),
    resolved: { intent: "apply", movedRecently: true, asked: null },
  });
  const blocks = toBlocks(forced.outputs);
  check("模型可以決定走哪個意圖", kinds(blocks).includes("signGrant"), kinds(blocks).join(","));
  check(
    "但述詞仍然只來自目的登記表",
    forced.programs.every((p) =>
      p.claims.every((c) => PURPOSES[p.purpose].allowedClaims.includes(c)),
    ),
  );

  // An unrecognised label must be ignored rather than fall through to whichever
  // branch happens to be last. Use a sentence the patterns do not match, so the
  // only thing that could produce a capsule is trusting the bogus label.
  const bogus = runTurn(getState(), "隨便講一句不相干的話", {
    today: effectiveToday(getState()),
    resolved: { intent: "not-an-intent" as never, movedRecently: true },
  });
  check(
    "不認識的意圖被忽略，不當聽懂",
    !kinds(toBlocks(bogus.outputs)).includes("signGrant"),
    kinds(toBlocks(bogus.outputs)).join(","),
  );

  // No router configured in the test environment: everything must still work.
  check("沒有設定 router 時模型不參與", !modelAvailable());
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("failed:", failures.join(" | "));
  process.exit(1);
}
