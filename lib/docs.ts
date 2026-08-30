export type DocsAudience = "所有人" | "使用者" | "開發者" | "政府機關";

export type DocsSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  code?: string;
  note?: string;
};

export type DocsArticle = {
  id: string;
  category: string;
  title: string;
  eyebrow: string;
  summary: string;
  audiences: DocsAudience[];
  readTime: string;
  keywords: string[];
  sections: DocsSection[];
};

export const DOCS_ARTICLES: DocsArticle[] = [
  {
    id: "overview",
    category: "開始使用",
    title: "GrantOnce 是什麼",
    eyebrow: "概念總覽",
    summary: "讓使用者找到已登記服務，逐次授權必要資料，再由資料來源直接交付辦理機關。",
    audiences: ["所有人"],
    readTime: "4 分鐘",
    keywords: ["grantonce", "授權匣", "述詞", "兩把鑰匙", "原理", "介紹"],
    sections: [
      {
        title: "不是把資料交給 AI",
        paragraphs: [
          "GrantOnce 讓助理協助找服務、整理流程與準備 Grant（授權匣），但助理拿不到簽署私鑰，也不能自行決定要讀哪些資料。",
          "授權匣裡放的是資格述詞，例如「設籍本市」或「幼兒落在適用年齡帶」，而不是姓名、地址、戶號或出生日期。",
        ],
      },
      {
        title: "服務先說需求，使用者再授權",
        paragraphs: ["辦理機關只能依已登記服務回傳本次必要資料。系統先讓使用者看見請求機關、資料來源、用途、保存期間與拒絕提供的影響；使用者簽章後，辦理機關還要證明持有綁定金鑰，資料來源才會交付。"],
        bullets: [
          "委託人決定要不要簽，而且每個目的分開簽。",
          "機關只能兌現綁定給自己的匣。",
          "一次性識別碼可防止同一份授權被重複使用。",
          "同意不能把機關的法定範圍變大。",
          "資料來源直接交付辦理機關，不把資料值放進語言模型上下文。",
        ],
      },
      {
        title: "目前的示範範圍",
        paragraphs: ["參考實作綁定育兒津貼、未滿 5 歲幼兒托育補助與住宅冷氣汰換補助。這三筆是示範範圍，不代表現實中只有這些補助。"],
        note: "公開搜尋可以找到其他方案；只有完成申請目的、資格條件與資料來源綁定的方案，才能建立授權匣。",
      },
    ],
  },
  {
    id: "service-data-flow",
    category: "開始使用",
    title: "服務請求與資料交付流程",
    eyebrow: "端到端資料流",
    summary: "分清楚誰提出需求、誰持有資料、誰簽署，以及資料最後交給誰。",
    audiences: ["所有人"],
    readTime: "6 分鐘",
    keywords: ["資料流", "服務請求", "請求機關", "資料來源", "直接交付", "最小揭露", "個資法"],
    sections: [
      {
        title: "角色不混在一起",
        bullets: [
          "使用者：提出服務需求，閱讀告知事項，決定是否簽署。",
          "服務／請求機關：登記服務、回傳本次必要資料、收到證明後辦理案件。",
          "資料來源機關：持有原始紀錄，驗證 Grant 後只釋放必要述詞。",
          "GrantOnce Agent：理解問題、協調流程；不能代簽，也不取得資料值。",
        ],
      },
      {
        title: "八個可稽核步驟",
        code: `1 服務探索       使用者詢問，找出已登記服務
2 服務需求確認   服務回傳本次必要資料，使用者決定要不要往下走
3 登記與法源檢查 確認之後才檢查：目的在登記表內、個資依據成立
4 最小化         通過檢查才鑄出授權匣，匣裡只有述詞
5 使用者簽署     閱讀告知事項後以 passkey 簽章
6 機關對機關交換 來源驗證簽章與持有證明，直接交付請求機關
7 服務處理       請求機關以述詞辦理案件
8 回覆與稽核     結果回覆使用者，每一步都留在稽核軌跡`,
        paragraphs: [
          "公開搜尋結果只用來發現可能的服務。未完成目的、法源、資料欄位與來源轉接器登記的結果，不能進入簽署或資料交付流程。",
          "第 2 步與第 3 步刻意分開。需求還沒被確認之前不會鑄出任何可簽署的匣，法源檢查也不會提前跑——先問「這個人要不要辦」，才問「這個機關有沒有權力要」。",
        ],
      },
      {
        title: "簽署不是唯一的合法性來源",
        paragraphs: ["Grant 會固定請求機關、資料來源、目的、資料類別、利用期間／地區／對象／方式、當事人權利與不提供的影響。簽署只證明使用者同意這份具體請求；系統仍會獨立檢查法定職務、特定目的與必要範圍。"],
        note: "本專案是技術參考實作，不取代機關就個別服務進行的法務、資安與保存政策審查。",
      },
      {
        title: "示範與正式部署的差異",
        paragraphs: ["示範版在同一個伺服器程序模擬請求機關與資料來源機關，但協定已把兩種角色、金鑰與稽核事件分開。正式部署必須讓來源轉接器在資料持有機關的信任邊界內執行，並把證明直接傳給請求機關。"],
      },
    ],
  },
  {
    id: "user-flow",
    category: "一般使用者",
    title: "從提問到送件",
    eyebrow: "使用流程",
    summary: "先找服務，再確認需求；檢查通過才鑄匣，簽署後才由來源交付並由機關辦理。",
    audiences: ["使用者"],
    readTime: "5 分鐘",
    keywords: ["怎麼用", "流程", "申請", "送件", "簽署", "使用者", "操作"],
    sections: [
      {
        title: "1. 用自己的話詢問服務",
        paragraphs: ["你可以說「我剛搬家，看我能申請什麼」，也可以只問某一項補助。助理負責理解與查找；只有已登記服務能繼續。"],
      },
      {
        title: "2. 服務回傳本次需求",
        paragraphs: ["系統會先顯示哪個機關辦理、哪些機關持有資料，以及本次需要哪些資格述詞。這張需求卡不是授權，也不會觸發資料調閱。"],
      },
      {
        title: "3. 確認之後，系統才做目的與法源檢查",
        paragraphs: ["按下確認，才會檢查這個目的有沒有掛在登記表上、個資依據是什麼、要的述詞有沒有超出必要範圍。通過了才鑄出授權匣。確認只是同意往下走，不等於同意簽署。"],
      },
      {
        title: "4. 看清楚 Grant 再簽署",
        paragraphs: ["每項服務都有獨立的用途、資料類別、接收機關、利用期間、權利說明、效期與法源。沒有「一次全部同意」。Passkey 私鑰不送到伺服器，模型也沒有代簽工具。"],
        bullets: ["確認請求機關與資料來源。", "確認只交付必要述詞。", "確認利用方式、保存期間與不提供的影響。"],
      },
      {
        title: "5. 來源驗證並直接交付",
        paragraphs: ["請求機關以自己的金鑰出示 Grant。資料來源驗證使用者簽章、機關持有證明、目的與最小範圍後，才把資格述詞直接交給請求機關。"],
      },
      {
        title: "6. 機關辦理並回覆",
        paragraphs: ["請求機關用收到的證明處理案件，再把進度、補件要求或結果回覆使用者。示範版只更新本地狀態，沒有串接真實政府系統。"],
      },
    ],
  },
  {
    id: "privacy-control",
    category: "一般使用者",
    title: "隱私、稽核與撤銷",
    eyebrow: "你保有控制權",
    summary: "知道誰取用過什麼、停止尚未發生的交付，並誠實面對撤銷邊界。",
    audiences: ["使用者", "政府機關"],
    readTime: "4 分鐘",
    keywords: ["隱私", "資料", "撤銷", "停止委託", "稽核", "誰拿過", "個資"],
    sections: [
      {
        title: "看得到每一步",
        paragraphs: ["核准、發證、簽署、兌現、送件、拒絕與通知都會留下稽核紀錄。助理看到的紀錄只含動作與必要識別資料，不含金庫內容或資格述詞的值。"],
      },
      {
        title: "撤銷有兩個層級",
        bullets: ["撤銷單張尚未兌現的 Grant。", "停止整個委託，讓所有未兌現 Grant 作廢並阻擋後續兌現。"],
        paragraphs: ["已經交付給機關的資料無法從對方系統收回。GrantOnce 會明確說明這個限制，不把撤銷包裝成不存在的能力。"],
      },
    ],
  },
  {
    id: "integration-overview",
    category: "開發者串接",
    title: "選擇串接方式",
    eyebrow: "串接方式",
    summary: "自有介面使用 HTTP API；要讓外部助理操作流程則使用 MCP。兩者共用同一個授權核心。",
    audiences: ["開發者"],
    readTime: "6 分鐘",
    keywords: ["串接", "整合", "開發者", "api", "mcp", "sdk", "agent", "項目方"],
    sections: [
      {
        title: "Web／HTTP API",
        paragraphs: ["適合自有前端、行動 App 或機關工作台。API 回傳使用者可見資料，簽署仍在使用者的瀏覽器完成。"],
        code: `POST /api/chat\nPOST /api/agency/request\nPOST /api/wallet/register\nPOST /api/grants/sign\nPOST /api/grants/redeem\nPOST /api/applications/submit`,
      },
      {
        title: "MCP",
        paragraphs: ["適合讓 Cursor、Codex 或其他 MCP 主機成為非信任協定客戶端。MCP 可以搜尋、規劃、兌現、送件、撤銷與查稽核，但工具清單刻意不提供簽署能力。"],
        code: `npm run mcp       # stdio\nnpm run mcp:http  # http://127.0.0.1:43128/mcp`,
      },
      {
        title: "共用的安全核心",
        paragraphs: ["不論入口是哪一個，最終都會經過服務需求綁定、目的登記、風險檢查、簽章驗證、機關持有證明與一次性識別碼。不要在客戶端複製一套較寬鬆的判斷。"],
      },
    ],
  },
  {
    id: "mcp-quickstart",
    category: "開發者串接",
    title: "MCP Agent 快速開始",
    eyebrow: "給 Agent 主機",
    summary: "啟動協定工具，讓 Agent 能操作流程，但不能取得使用者私鑰。",
    audiences: ["開發者"],
    readTime: "7 分鐘",
    keywords: ["mcp", "cursor", "codex", "agent host", "工具", "quickstart", "快速開始"],
    sections: [
      {
        title: "啟動",
        paragraphs: ["Web 與 MCP 要共用同一個 GRANTONCE_STORE。預設 store 位於 /tmp/grantonce-runtime.json。"],
        code: `npm install\nnpm run dev\n# 另一個 terminal\nnpm run mcp`,
      },
      {
        title: "建議的工具順序",
        bullets: [
          "search_purposes：分開顯示公開找到的方案，以及目前系統能建立授權的方案。",
          "plan_applications：把原話交給規則引擎。",
          "request_claims：讓已登記服務回傳本次必要資料；超出登記範圍時立即拒絕。",
          "get_grant_for_signature：顯示同意文字與待簽 bytes。",
          "等待使用者在 localhost 的皮夾 UI 簽署。",
          "redeem_grant → submit_application。",
        ],
      },
      {
        title: "永遠不要假設已簽",
        paragraphs: ["聊天中的口頭同意不是簽章。只要 Grant 狀態仍是 proposed（待簽署），就必須停下來等待使用者操作。"],
        note: "MCP 工具不回傳金庫內容或述詞值；兌現成功只回資格證明 ID、交付對象與資料來源。",
      },
    ],
  },
  {
    id: "purpose-integration",
    category: "開發者串接",
    title: "新增一個補助目的",
    eyebrow: "Purpose onboarding",
    summary: "新增目的不是改提示詞，而是完成法源、資格證明與發證轉接器的可驗證綁定。",
    audiences: ["開發者", "政府機關"],
    readTime: "8 分鐘",
    keywords: ["新增補助", "purpose", "registry", "issuer adapter", "述詞", "法源", "登記台"],
    sections: [
      {
        title: "必要資料",
        bullets: ["唯一的服務目的 ID、顯示名稱與請求機關。", "請求機關與資料來源機關各自可驗證的金鑰。", "個資蒐集、處理及利用的依據。", "允許的最小資格證明清單。", "利用期間、地區、對象、方式、當事人權利與不提供的影響。", "最長 Grant 效期與白話必要性說明。"],
      },
      {
        title: "發證轉接器（Issuer adapter）",
        paragraphs: ["每項資格證明都必須由可信來源從原始紀錄推導並簽發，再直接交給 Grant 綁定的請求機關。若缺少來源或轉接器，系統應該說「尚未綁定」，不能讓模型發明資格述詞。"],
      },
      {
        title: "上線前驗證",
        bullets: ["超出範圍的資格證明，即使使用者簽署也會被拒絕。", "服務需求、個資告知事項或直接交付對象被改動時會拒絕。", "錯誤機關無法兌現。", "舊持有證明不能用在新的授權上。", "收件匣只包含該目的允許的述詞。"],
      },
    ],
  },
  {
    id: "government-pilot",
    category: "政府導入",
    title: "政府部門如何開始試辦",
    eyebrow: "Pilot blueprint",
    summary: "從一個低風險、高重複性的流程開始，先驗證責任與資料最小化。",
    audiences: ["政府機關"],
    readTime: "8 分鐘",
    keywords: ["政府", "機關", "導入", "試辦", "標案", "治理", "公部門", "部署"],
    sections: [
      {
        title: "第一階段：選一個窄目的",
        paragraphs: ["選擇資格規則清楚、所需資料少、量體可觀察的補助。先列出法定目的與真正必要的資格述詞，不以現有表單欄位直接當作需求。"],
      },
      {
        title: "第二階段：分清楚三方責任",
        bullets: ["請求機關管理服務登記、兌現金鑰、案件處理與結果回覆。", "資料來源機關管理來源轉接器，並對資格述詞的推導、驗證、簽章與交付負責。", "使用者只在自己的認證器簽署。", "Agent 僅負責說明、規劃與流程協調。"],
      },
      {
        title: "第三階段：影子模式",
        paragraphs: ["先讓 GrantOnce 與既有人工流程並行，但不直接影響核定。比較資料欄位縮減、完成時間、拒絕原因與民眾理解度，再決定是否擴大。"],
      },
      {
        title: "正式串接前",
        paragraphs: ["必須把示範版內的請求機關與資料來源機關私鑰移到各自控制的服務，加入 mTLS 或政府憑證來源認證，建立來源到請求機關的直接傳輸，並接上真實案件編號、補件與狀態通知。"],
      },
    ],
  },
  {
    id: "governance",
    category: "政府導入",
    title: "法遵與目的治理",
    eyebrow: "Governance",
    summary: "同意不是萬用法源；目的登記表是獨立於使用者簽章的第二道上限。",
    audiences: ["政府機關", "開發者"],
    readTime: "6 分鐘",
    keywords: ["法遵", "個資法", "法源", "目的治理", "最小化", "比例原則", "稽核"],
    sections: [
      {
        title: "目的先於欄位",
        paragraphs: ["每個申請目的要先說清楚法定職務、方案依據與必要性，才能決定允許哪些資格證明。不能先蒐集整份資料，再用同意補正範圍；使用者簽章也不會自動讓蒐集、處理或利用變成合法。"],
      },
      {
        title: "同意仍然有上限",
        paragraphs: ["若資格證明超出機關法定職務必要範圍，風險引擎在提案與兌現兩個階段都會阻擋。這個判斷不會因為使用者已簽署而放寬。"],
      },
      {
        title: "治理流程",
        bullets: ["法務確認法定職務、個資使用依據、告知義務與方案法源。", "業務單位確認資格規則、必要證明與拒絕提供時的替代流程。", "資安單位確認雙方金鑰、來源認證、直接交付、保存期限與稽核。", "版本變更要留下申請目的、告知文字與轉接器的審查紀錄。"],
      },
    ],
  },
  {
    id: "security-model",
    category: "安全與參考",
    title: "安全模型與已知限制",
    eyebrow: "預設拒絕",
    summary: "看懂哪些保證已由程式落實，以及示範部署尚未具備哪些生產條件。",
    audiences: ["所有人"],
    readTime: "7 分鐘",
    keywords: ["安全", "威脅", "限制", "production", "私鑰", "重放", "fail closed"],
    sections: [
      {
        title: "目前有測試覆蓋的保證",
        bullets: ["Ed25519 簽章覆蓋服務需求、直接交付設定、結構化告知事項與 canonical Grant bytes。", "audience 與 cnf.jkt 綁定請求機關金鑰。", "jti 一次性與並行兌現鎖。", "目的 allowlist 與特定高風險資料攔截。", "資料來源逐一留下 release 稽核。", "MCP payload 的 vault／predicate value 外洩檢查。"],
      },
      {
        title: "示範部署的限制",
        paragraphs: ["目前 `/api/grants/redeem` 與 MCP 會在同一個伺服器程序模擬請求機關、資料來源機關與直接交付。協定角色與驗證已分開，但部署層尚未形成真正的跨機關信任邊界。"],
        bullets: ["案件送出與後續狀態是 fixture。", "合成身分與本地 JSON vault 不是真實 MyData。", "語言模型不取得資料值，但示範伺服器程序仍會處理它們。", "Passkey PRF 必須在目標裝置實測。", "正式版需要雙方來源認證、金鑰管理、點對點傳輸、監控與資料保存政策。"],
      },
    ],
  },
  {
    id: "grant-reference",
    category: "安全與參考",
    title: "Grant 與工具參考",
    eyebrow: "Protocol reference",
    summary: "快速查閱 Grant 欄位、狀態生命週期與 agent 可用工具。",
    audiences: ["開發者", "政府機關"],
    readTime: "6 分鐘",
    keywords: ["grant", "schema", "欄位", "工具", "狀態", "jti", "cnf", "aud"],
    sections: [
      {
        title: "核心欄位",
        code: `iss                 holder identifier\nrequestId           registered service request\nrequester / aud      requesting agency\ndataSources          source authorities\ndelivery             issuer-to-requester binding\npurpose / claims     registered purpose and minimum predicates\nnotice               structured privacy notice\ncnf.jkt              requester key thumbprint\njti                   one-time identifier\niat / exp             issued-at and expiry\ndisplayText           exact consent copy`,
        paragraphs: ["簽章驗證後仍會重新序列化 body，比對它是否與當初簽署的 bytes 完全相同。"],
      },
      {
        title: "生命週期",
        code: `proposed → signed → redeemed\n    └──────→ revoked\n    └──────→ expired`,
        paragraphs: ["建立新提案會換新的 jti、效期與簽章；舊 Grant 不會原地復活。"],
      },
      {
        title: "Agent tools",
        paragraphs: ["工具涵蓋搜尋、規劃、顯示待簽內容、兌現、送件、撤銷、稽核、通知與待辦。簽署不在工具清單中。"],
      },
    ],
  },
];

export const DOCS_CATEGORIES = [...new Set(DOCS_ARTICLES.map((article) => article.category))];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[，。！？、,.!?/\\()（）:：]/g, " ").replace(/\s+/g, " ").trim();
}

export function findDocs(query: string): DocsArticle[] {
  const q = normalize(query);
  if (!q) return DOCS_ARTICLES;
  const tokens = q.split(" ").filter(Boolean);

  return DOCS_ARTICLES.map((article) => {
    const title = normalize(`${article.title} ${article.summary} ${article.eyebrow}`);
    const content = normalize(
      article.sections
        .flatMap((section) => [section.title, ...(section.paragraphs ?? []), ...(section.bullets ?? [])])
        .join(" "),
    );
    let score = 0;
    for (const keyword of article.keywords) {
      const k = normalize(keyword);
      if (q.includes(k)) score += 8;
    }
    for (const token of tokens) {
      if (title.includes(token)) score += 5;
      else if (content.includes(token)) score += 2;
    }
    return { article, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.article);
}

const CURATED_ANSWERS: Array<{ pattern: RegExp; answer: string; sources: string[] }> = [
  {
    pattern: /隱私|個資|資料|撤銷|稽核|誰.*取用|安全/,
    answer: "已登記服務先列出必要述詞與資料來源；使用者簽署後，來源才把最小證明直接交付請求機關，不提供給語言模型。未兌現的 Grant 可撤銷，但已交付資料不能從對方系統收回。",
    sources: ["privacy-control", "service-data-flow", "security-model"],
  },
  {
    pattern: /串接|整合|開發|api|mcp|cursor|codex/i,
    answer: "自有介面可用 HTTP API；外部助理可用 MCP。兩種入口共用服務需求、目的登記、風險與簽章驗證；簽署留在使用者認證器，資料值不回傳給 Agent。",
    sources: ["integration-overview", "mcp-quickstart", "purpose-integration"],
  },
  {
    pattern: /怎麼用|流程|申請|簽署|送件/,
    answer: "使用者詢問後，系統只從已登記服務取得本次必要資料，並先把需求原樣顯示出來——這時還沒有任何可簽署的匣。使用者確認要辦，系統才做目的與法源檢查；通過了才鑄出匣，簽署後來源直接交付最小證明，最後由請求機關辦理並回覆。",
    sources: ["user-flow", "service-data-flow", "overview"],
  },
  {
    pattern: /政府|機關|公部門|試辦|導入/,
    answer: "政府試辦應先選一個窄目的，分開請求機關與資料來源機關責任，並用影子模式驗證最小揭露。正式上線前，雙方私鑰與來源轉接器都要移出示範程序，建立直接傳輸與案件狀態串接。",
    sources: ["government-pilot", "governance", "security-model"],
  },
];

export function answerDocsQuestion(question: string) {
  const q = question.trim();
  const curated = CURATED_ANSWERS.find((entry) => entry.pattern.test(q));
  const matched = curated
    ? curated.sources.map((id) => DOCS_ARTICLES.find((article) => article.id === id)).filter((article): article is DocsArticle => Boolean(article))
    : findDocs(q).slice(0, 3);

  if (!matched.length) {
    return {
      answer: "這份文件裡目前沒有直接對應的說明。你可以改問使用流程、開發者串接、政府試辦、隱私或安全模型。",
      sources: [] as Array<Pick<DocsArticle, "id" | "title" | "summary">>,
    };
  }

  return {
    answer: curated?.answer ?? `我找到最接近的內容：${matched[0].summary}`,
    sources: matched.map(({ id, title, summary }) => ({ id, title, summary })),
  };
}
