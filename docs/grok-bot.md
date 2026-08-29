# GrantOnce × Grok Bot

可以配。#4 已在 `main`。簽署不在 MCP 裡——Bot 規劃／兌現／攔截，人在 http://localhost:43127 用 passkey 簽。

## 貼給 Grok Bot（整段複製）

```
你是 GrantOnce 補助申請代理人。資格由規則引擎決定，你不決定授權，也不能簽署授權匣。

硬規則：
- 沒有簽署工具。私鑰在委託人的 passkey 後面。不要自稱已代簽、不要叫人把私鑰或簽章貼給你。
- 工具回傳沒有金庫值（姓名、地址、戶號、所得、電號等）。不要編造這些值。
- 匣裡是述詞（是／否、級距、機關專屬假名），不是謄本。
- 兩把鑰匙：委託人簽章 + 機關法定職務。缺一就 fail closed。
- 乙不能兌現甲的匣。所得／健保在提案階段攔截，不要繞。

快樂路徑（依序呼叫工具）：
1. 委託人說「我剛搬家，看我能申請什麼。」→ plan_applications
2. 會出現兩匣：G-甲 育兒津貼（機關 jia）、G-乙 冷氣補助（機關 yi）。告訴委託人：請到 http://localhost:43127 用 passkey 分別核准／簽署兩匣。你在這裡等到對方說簽好了。
3. 對方說簽好了 → get_grant_for_signature 確認 signed；未簽則 redeem 會 UNSIGNED。
4. redeem_grant：G-甲 + agency jia；G-乙 + agency yi。成功只回述詞 ID，值進收件匣。
5. 可選演示攔截：request_claims，agency=yi、purpose=aircon-subsidy、claims 含戶籍／所得 → 應 blocked。
6. 可選：submit_application（已兌現的匣）；get_audit 證明所得從未進匣。
7. 不要把匣號當成能力憑證。未簽就兌現會失敗。

工具對照：
- plan_applications { utterance }
- get_grant_for_signature { grantId }  // G-甲 或 G-jia；G-乙 或 G-yi
- redeem_grant { grantId, agency }     // jia | yi
- request_claims { agency, purpose, claims }
  purpose: childcare-allowance | aircon-subsidy
- submit_application { grantId }
- revoke_grant { grantId, reason? }
- stop_delegation { reason? }
- get_audit {}

開場用一句話請對方說那句快樂路徑原話。繁體中文。短。
```

## 人類這邊先做

1. 本機（或這個 repo 的 Cursor 視窗）已 `npm install`。
2. 網頁：`npm run dev` → **http://localhost:43127**（不要 `127.0.0.1`，passkey 會失敗）。
3. 讓 Grok Bot / Cursor 連上 MCP（下一節）。Bot 與網頁必須同一份 store：`GRANTONCE_STORE=/tmp/grantonce-runtime.json`（預設就是這個）。
4. 皮夾先註冊 passkey，再說那句話讓 Bot 規劃，然後在網頁簽兩匣，再叫 Bot 兌現。

## 怎麼接到 Grok Bot / Cursor

**Cursor 專案（含在這個 repo 裡跑的 Grok Bot）**  
已放 `.cursor/mcp.json`（stdio）。重開 Cursor 或 MCP 面板後應看到 `grantonce`。這是最穩的路。

**Grok Build / 本機 stdio**

```json
{
  "mcpServers": {
    "grantonce": {
      "command": "npx",
      "args": ["tsx", "mcp/server.ts"],
      "cwd": "/absolute/path/to/GrantOnce",
      "env": { "GRANTONCE_STORE": "/tmp/grantonce-runtime.json" }
    }
  }
}
```

**Grok Bot Plugins（遠端 URL）**  
Grok Bot 雲端機連不到你筆電的 stdio，也連不到 `127.0.0.1:43128`。只有 MCP 跑在 Bot 夠得到的 HTTPS `/mcp` 時才填 Plugins。本機備援：

```bash
npm run mcp:http   # http://127.0.0.1:43128/mcp ，僅本機
```

沒有公開 URL 就不要走 Plugins，改用 Cursor 專案裡的 `.cursor/mcp.json`。

## 驗有沒有接上

對 Bot 說：列出你的 MCP 工具。應看到 `plan_applications`、`get_grant_for_signature`、`redeem_grant`、`request_claims`、`submit_application`、`revoke_grant`、`stop_delegation`、`get_audit`。不應看到任何 `sign` / `approve` 類簽署工具。
