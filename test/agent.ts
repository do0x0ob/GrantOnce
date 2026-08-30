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
import {
  cleanReply,
  modelAvailable,
  shouldClassifyForChat,
  shouldResearchForChat,
} from "../lib/agent/intent";
import { agentSkillsPrompt, loadAgentSkills } from "../lib/agent/skills";
import { runTurn } from "../lib/agent/turn";
import { evaluateInquiry } from "../lib/inquiry";
import { effectiveToday, HAPPY_PATH_UTTERANCE, matchPrograms, situationFromUtterance } from "../lib/rules";
import { isRelevantProgramTitle } from "../lib/research";
import { confirmServiceRequest, openServiceRequests, proposeGrantsFromPlan } from "../lib/authz";
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

console.log("\n第一拍只到服務需求，不給簽署卡");
{
  // The beat that used to be missing. Discovery states what each service needs;
  // nothing is minted and nothing is signable until the person says yes.
  const turn = runTurn(getState(), "我剛搬家，看我能申請什麼。");
  mutate((s) => openServiceRequests(s, turn.programs));
  const blocks = toBlocks(turn.outputs);
  const requirementCards = blocks.filter((b) => b.kind === "serviceRequirement");
  const statusCards = blocks.filter((b) => b.kind === "applicationStatus");
  check("服務需求卡數量等於申請案數量", requirementCards.length === turn.programs.length);
  check("這一拍沒有簽署卡", !kinds(blocks).includes("signGrant"), kinds(blocks).join(","));
  check("這一拍沒有法源檢查卡", !kinds(blocks).includes("legalCheck"), kinds(blocks).join(","));
  check("這一拍一張匣都沒鑄", getState().grants.length === 0, String(getState().grants.length));
  check(
    "需求全部停在等待確認",
    getState().serviceRequests.every((r) => r.status === "awaiting-confirmation" && r.grantId === null),
  );
  check("進度卡數量等於申請案數量", statusCards.length === turn.programs.length);
  check("比對結果卡在需求卡前面", kinds(blocks).indexOf("eligibility") < kinds(blocks).indexOf("serviceRequirement"));
  check("需求卡後面給得出確認的方法", kinds(blocks).indexOf("suggestions") > kinds(blocks).indexOf("serviceRequirement"));
  check("需求卡只帶 purpose id，不夾帶資料值", requirementCards.every((block) =>
    block.kind === "serviceRequirement" && Object.keys(block).sort().join(",") === "kind,purpose"));
}

console.log("\n確認之後才檢查法源，才鑄匣");
{
  const turn = runTurn(getState(), "確認育兒津貼的資料需求");
  mutate((s) => {
    for (const id of turn.confirms) confirmServiceRequest(s, id);
  });
  const blocks = toBlocks(turn.outputs);
  const signCards = blocks.filter((b) => b.kind === "signGrant");
  check("確認的是被指名的那一項", turn.confirms.length === 1);
  check("先出法源檢查卡，才出簽署卡", kinds(blocks).indexOf("legalCheck") < kinds(blocks).indexOf("signGrant"));
  check("這一拍才出現簽署卡", signCards.length === 1, kinds(blocks).join(","));
  check(
    "每張簽署卡都指向一張真的存在的匣",
    signCards.every((b) => b.kind === "signGrant" && getState().grants.some((g) => g.id === b.grantId)),
  );
  check("只鑄了被確認的那一張匣", getState().grants.length === 1, String(getState().grants.length));
  check(
    "沒被確認的需求仍然沒有匣",
    getState().serviceRequests.some((r) => r.status === "awaiting-confirmation" && r.grantId === null),
  );
  check("法源檢查卡也只帶 purpose id", blocks.filter((b) => b.kind === "legalCheck").every((block) =>
    Object.keys(block).sort().join(",") === "kind,purpose"));

  // The card has nothing to render unless the check writes down what it found,
  // and what it found must be the capsule's own verdict rather than a retelling.
  const confirmed = getState().serviceRequests.find((r) => r.status === "awaiting-signature")!;
  const minted = getState().grants.find((g) => g.id === confirmed.grantId)!;
  check("檢查結果記在需求上", confirmed.checkNotes.length > 0, JSON.stringify(confirmed.checkNotes));
  check(
    "記的就是這張匣的判定，不是另一套說法",
    confirmed.checkNotes.join("|") === minted.riskNotes.join("|"),
    confirmed.checkNotes.join("|"),
  );
  check("確認的時間有留下", Boolean(confirmed.confirmedAt));
}

console.log("\n指名一項已經簽掉的，不會順手確認別的");
{
  // The fallback to 「唯一一項」 must not apply once something was named: saying
  // 確認育兒津貼 twice used to confirm 冷氣汰換補助 instead, which is exactly the
  // handed-a-capsule-you-did-not-name failure this whole design is against.
  const before = getState().grants.length;
  const again = runTurn(getState(), "確認育兒津貼的資料需求");
  check("重複確認不會再鑄任何匣", again.confirms.length === 0, again.confirms.join(","));
  mutate((s) => {
    for (const id of again.confirms) confirmServiceRequest(s, id);
  });
  check("匣的數量沒有變", getState().grants.length === before, String(getState().grants.length));
  check("也沒有替冷氣汰換補助鑄匣", !getState().grants.some((g) => g.body.purpose === "aircon-subsidy"));
}

console.log("\n沒有待確認的東西時，「確認」不會憑空開始比對");
{
  resetState();
  const turn = runTurn(getState(), "確認");
  check("不會生出服務需求", turn.programs.length === 0);
  check("不會鑄匣", turn.confirms.length === 0);
  check("只是說明沒有東西要確認", !kinds(toBlocks(turn.outputs)).includes("serviceRequirement"));
}

console.log("\n卡片只帶 id，不帶快照");
{
  // A grant carries plenty that a card must not snapshot; feed the matcher a
  // whole grant and require that only the id survives. Built here rather than
  // inherited, so reordering the sections above cannot leave this with nothing.
  const situation = situationFromUtterance(HAPPY_PATH_UTTERANCE, effectiveToday(getState()))!;
  mutate((s) => proposeGrantsFromPlan(s, matchPrograms(situation)));
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
  const all = runTurn(getState(), "我剛搬家，看我能申請什麼。");
  check("沒指名時列出全部符合的", all.programs.length > 1, String(all.programs.length));

  const named = runTurn(getState(), "要搞育兒津貼");
  check("指名育兒津貼只回一項", named.programs.length === 1, named.programs.map((p) => p.purpose).join(","));
  check("而且就是那一項", named.programs[0]?.purpose === "childcare-allowance");
  check(
    "會說出它沒有替你要的那些",
    toBlocks(named.outputs).some((b) => b.kind === "text" && b.text.includes("我就不會替你要")),
  );

  // Narrowing must never be able to add something the rule engine did not match.
  const bogus = runTurn(getState(), "我要辦一個不存在的補助");
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

console.log("\n模型接手之後，指名一項仍然只給一項");
{
  // Every other test here runs with no router configured, so the whole
  // classifier branch went uncovered — and that is the branch that dropped the
  // narrowing: 「要搞育兒津貼」 came back with 冷氣汰換補助 attached.
  const withModel = (utterance: string, movedRecently: boolean) => {
    resetState();
    return runTurn(getState(), utterance, {
      today: effectiveToday(getState()),
      resolved: { intent: "apply", movedRecently },
    }).programs.map((p) => p.purpose);
  };

  check(
    "有模型時指名育兒津貼，不會多給冷氣",
    withModel("要搞育兒津貼", false).join(",") === "childcare-allowance",
    withModel("要搞育兒津貼", false).join(","),
  );
  check(
    "有模型時指名冷氣，不會多給育兒津貼",
    withModel("我要換冷氣的補助", false).join(",") === "aircon-subsidy",
    withModel("我要換冷氣的補助", false).join(","),
  );

  // The classifier earns its place by reading a move the patterns cannot; that
  // must keep working, and a bare move still lists everything.
  const unseen = withModel("我換了個地方住", true);
  check("正則看不懂的搬家說法，模型仍然能打開兩項", unseen.length === 2, unseen.join(","));

  const patterned = withModel("我剛搬家，看我能申請什麼。", true);
  check("一般的搬家問法照樣兩項都列", patterned.length === 2, patterned.join(","));
}

console.log("\n模型只當「聽懂」那一層");
{
  // The classifier's output must be able to change which intent runs, and
  // nothing else. Claim it says "apply" for a sentence the patterns would not
  // match, and the rule engine still governs what gets asked for.
  const forced = runTurn(getState(), "隨便講一句不相干的話", {
    today: effectiveToday(getState()),
    resolved: { intent: "apply", movedRecently: true },
  });
  const blocks = toBlocks(forced.outputs);
  check("模型可以決定走哪個意圖", kinds(blocks).includes("serviceRequirement"), kinds(blocks).join(","));
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
    "不認識的意圖被忽略，退回正則",
    !kinds(toBlocks(bogus.outputs)).includes("signGrant"),
    kinds(toBlocks(bogus.outputs)).join(","),
  );

  // No router configured in the test environment: everything must still work.
  check("沒有設定 router 時模型不參與", !modelAvailable());
}

console.log("\nlocal skill 讓理解變寬，但不擴大權限");
{
  const skills = loadAgentSkills();
  check("載入 apply-with-grant", skills.some((skill) => skill.id === "apply-with-grant"));
  check("skill 內容真的進模型 context", agentSkillsPrompt().includes("Conversation is not consent"));

  const explain = runTurn(getState(), "育兒津貼和托育補助差在哪？", {
    today: effectiveToday(getState()),
    resolved: {
      intent: "apply",
      movedRecently: false,
      skill: "apply-with-grant",
      skillAction: "explain",
      reply: "我先說明兩者差異，不會因此替你建立授權。",
    },
  });
  check("單純解釋不建 Grant", explain.programs.length === 0);
  check("單純解釋不顯示簽署卡", !kinds(toBlocks(explain.outputs)).includes("signGrant"));
  const explainText = toBlocks(explain.outputs)
    .filter((block) => block.kind === "text")
    .map((block) => block.text);
  check("解釋分支保留固定能力邊界", explainText.some((text) => text.includes("明確要開始比對")));
  check("解釋分支不混入模型寒暄", !explainText.includes("我先說明兩者差異，不會因此替你建立授權。"));

  const plan = runTurn(getState(), "我剛搬家，幫我看看能申請什麼", {
    today: effectiveToday(getState()),
    resolved: {
      intent: "apply",
      movedRecently: true,
      skill: "apply-with-grant",
      skillAction: "plan",
    },
  });
  check("明確 plan 才進規則引擎", plan.programs.length > 0);
  check(
    "skill 仍不能發明述詞",
    plan.programs.every((program) =>
      program.claims.every((claim) => PURPOSES[program.purpose].allowedClaims.includes(claim)),
    ),
  );
}

console.log("\n公開搜尋只在真的需要時出現");
{
  check("自我介紹直接走固定規則", !shouldClassifyForChat("你是誰"));
  check("補助說法才交給語言模型理解", shouldClassifyForChat("搬家後有哪些方案適合我"));
  check("自我介紹不搜尋", !shouldResearchForChat("你是誰", { intent: "help", movedRecently: false }));
  check(
    "模型誤判時，自我介紹仍不搜尋",
    !shouldResearchForChat("你是誰", { intent: "apply", movedRecently: false }),
  );
  check("查申請進度不搜尋", !shouldResearchForChat("我的申請到哪了？", null));
  check("詢問補助才搜尋", shouldResearchForChat("我剛搬家，看我能申請什麼", null));
  check("保留真正的救助方案", isRelevantProgramTitle("社會救助", "住家淹水後有哪些補助？"));
  check("排除名字碰巧含救助的組織", !isRelevantProgramTitle("中華基督教救助協會", "住家淹水後有哪些補助？"));
  check("排除災害新聞事件", !isRelevantProgramTitle("花蓮馬太鞍溪堰塞湖災害", "住家淹水後有哪些補助？"));
  check("固定主題以外仍接受方案型標題", isRelevantProgramTitle("青年租金補貼方案", "租屋族可以申請什麼？"));

  const identity = runTurn(getState(), "你是誰", {
    today: effectiveToday(getState()),
    resolved: {
      intent: "help",
      movedRecently: false,
      reply: "我是 GrantOnce 的語言理解層。",
    },
  });
  const identityText = toBlocks(identity.outputs).filter((block) => block.kind === "text");
  check("自我介紹只留一份", identityText.length === 1, JSON.stringify(identityText));
  check(
    "身份說明包含能力邊界",
    identityText.some(
      (block) =>
        block.kind === "text" &&
        block.text.includes("服務申請助手") &&
        block.text.includes("不代簽") &&
        block.text.includes("不取得資料值"),
    ),
  );
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("failed:", failures.join(" | "));
  process.exit(1);
}
