import { answerDocsQuestion, DOCS_ARTICLES, DOCS_CATEGORIES, findDocs } from "../lib/docs";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
    return;
  }
  failures.push(name);
  console.log(`  FAIL ${name} ${detail}`);
}

console.log("文件資訊架構");
{
  check("五個清楚的分類", DOCS_CATEGORIES.length === 5, DOCS_CATEGORIES.join(","));
  check("每篇 id 唯一", new Set(DOCS_ARTICLES.map((article) => article.id)).size === DOCS_ARTICLES.length);
  check("有一般使用者入口", DOCS_ARTICLES.some((article) => article.audiences.includes("使用者")));
  check("有開發者入口", DOCS_ARTICLES.some((article) => article.audiences.includes("開發者")));
  check("有政府機關入口", DOCS_ARTICLES.some((article) => article.audiences.includes("政府機關")));
}

console.log("\n文件講的流程要跟程式一致");
{
  // The docs went stale once already: they described the requirement leading
  // straight into signing, which stopped being true the day confirmation became
  // its own beat. These pin the order the code actually implements.
  const flow = DOCS_ARTICLES.find((article) => article.id === "service-data-flow")!;
  const steps = flow.sections.map((section) => section.code ?? "").join("\n");
  const walkthrough = DOCS_ARTICLES.find((article) => article.id === "user-flow")!;
  const titles = walkthrough.sections.map((section) => section.title).join("\n");

  check("資料流有服務需求確認這一步", steps.includes("服務需求確認"), steps);
  check("資料流有登記與法源檢查這一步", steps.includes("登記與法源檢查"), steps);
  check(
    "確認排在簽署之前",
    steps.indexOf("服務需求確認") < steps.indexOf("使用者簽署"),
    steps,
  );
  check(
    "法源檢查排在確認之後、簽署之前",
    steps.indexOf("服務需求確認") < steps.indexOf("登記與法源檢查") &&
      steps.indexOf("登記與法源檢查") < steps.indexOf("使用者簽署"),
    steps,
  );
  check("使用者流程也寫了確認那一步", titles.includes("確認"), titles);
}

console.log("\n文件搜尋");
{
  check("串接找到 integration", findDocs("我想串接 API")[0]?.id === "integration-overview");
  check("政府試辦找到 pilot", findDocs("政府部門如何試辦")[0]?.id === "government-pilot");
  check("無關內容回空結果", findDocs("火星馬鈴薯養殖").length === 0);
}

console.log("\n文件代理人");
{
  const developer = answerDocsQuestion("我是開發者，要怎麼串接？");
  check("開發者回答有來源", developer.sources.length > 0);
  check("開發者回答不會要求私鑰", !developer.answer.includes("提供私鑰"));

  const government = answerDocsQuestion("政府機關正式導入要注意什麼？");
  check("政府回答指向試辦文件", government.sources.some((source) => source.id === "government-pilot"));
  check("政府回答揭露部署限制", government.answer.includes("私鑰") && government.answer.includes("示範"));

  const governmentPrivacy = answerDocsQuestion("政府會拿到我的哪些資料？");
  check(
    "同時提到政府與資料時優先回答隱私",
    governmentPrivacy.sources[0]?.id === "privacy-control",
  );

  const governmentApi = answerDocsQuestion("政府系統要怎麼串接 API？");
  check(
    "同時提到政府與 API 時優先回答串接",
    governmentApi.sources[0]?.id === "integration-overview",
  );

  const unknown = answerDocsQuestion("火星馬鈴薯養殖");
  check("未知問題誠實說沒有", unknown.sources.length === 0 && unknown.answer.includes("沒有直接對應"));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("failed:", failures.join(" | "));
  process.exit(1);
}
