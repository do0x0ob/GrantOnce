# GrantOnce 分匣授權

只准這一次，而且只准這一匣。

委託人核准最小欄位授權匣，AI 代理人才能向假 MyData 擷取資料、替你送補助申請。每個機關只看得到自己那一匣。送件後授權立刻耗用。越權請求直接 403。

GrantOnce 是一套小而通用的授權協定（與哪個助手／MCP 宿主無關）。演示 UI 只是 harness。

## 怎麼跑

1. `npm install`
2. `npm run dev`
3. 打開終端機印出的網址（預設 `http://127.0.0.1:43127`）

需要 Node 20+。沒有環境變數、沒有資料庫、沒有真實 MyData。

## 90 秒演示腳本

預設委託人是合成身分 **林曉晴**（臺北市 → 新北市，家中有一歲幼兒）。

1. 左欄點「演示這句」，或自己打：`我剛搬家，看我能申請什麼。`
2. 代理人列出兩個申請案與原因：
   - 育兒津貼 → 機關甲（新北市社會局）：只要戶籍＋親子關係
   - 冷氣汰換補助 → 機關乙（經濟部 × 台電）：只要電表號＋近三月用電
   - 會出現個人化提示：孩子滿 2 歲後，育兒津貼條件會改變
3. 左欄出現兩張匣。分別按「核准這一匣」。**沒有「一次交出全部資料」按鈕。**
4. 代理人立刻用 `Authorization: Bearer Grant <id>` 向假 MyData 擷取。右欄甲、乙收件匣欄位不同。所得不會出現。
5. 右欄乙按「索取戶籍謄本」→ 乙卡與稽核出現 403 芯片，稽核多一筆拒絕。
6. 右欄甲按「送出申請」→ 匣 `G-甲` 變成已耗用／已撤銷。
7. 甲按「重放擷取」→ 再次 403。
8. 看稽核時間線：核准、擷取、送件、撤銷、拒絕。

重來：右上「重設演示」。

## 簡報與錄影

- 12 頁：`pitch/GrantOnce.pptx`（大綱 `pitch/slides.md`）
- 3–5 分鐘畫面腳本：`pitch/demo-script.md`

## 什麼是假的

- 林曉晴、子女、地址、戶號、所得、健保、電表、用電量：全部合成
- MyData 金庫：本地 JSON，不是真實個人資料服務
- 社會局／經濟部／台電收件：畫面模擬，沒有真正送件
- 送件成功：只改授權狀態，不會把資料送到任何機關

## 什麼是真的（在這個演示裡）

- **規則引擎**決定資格：搬家 + 0–2 歲幼兒 → 育兒津貼；有住宅電表 → 冷氣補助。模型不決定授權。
- **授權匣**才是授權層：`Bearer Grant G-甲` / `G-乙`，欄位白名單，沒有 `fields:*`
- 越權或已耗用：fail closed，不回傳部分欄位
- 所得在金庫裡，快樂路徑不會進入任何匣

## 畫面三欄

| 欄 | 做什麼 |
| --- | --- |
| 匣 | 左上「演示這句」觸發器、兩張匣卡（核准／撤銷） |
| 金庫 | 假 MyData；所得留在這裡，不進任何匣 |
| 機關 | 甲／乙收件、403 芯片、稽核時間線 |

## 授權協定

每個 Grant 都是：

| 欄位 | 意思 |
| --- | --- |
| `id` | 匣編號 |
| `issuer` | 誰核准（人／法院／機構的 principal id，不可硬編姓名） |
| `subject` | 金庫列是誰的資料 |
| `audience` | 誰可以使用這張匣（擷取／送件） |
| `purpose` | 用途 |
| `fields[]` | 白名單，沒有 `*` |
| `source` | `mydata` \| `wallet` \| `user` |
| `expiresAt` | 過期時間 |
| `status` | `pending` \| `active` \| `consumed` \| `revoked` |
| `revokeOn` | `submitted` \| `user` \| `expired` |

`fetch_field` 與 `submit_application` 目前仍用**工具／請求參數** `actor` 來比對 `audience`。參數對不上 → 403 + 稽核。這不是 runtime 綁定：呼叫端仍可謊報 `actor`。把 `actor` 從 session 綁死留給下一 PR。

`revoke_grant` 必須由 `issuer` 撤銷。宣告的 caller（或省略時的 session principal）對不上 → 403 + 稽核。`approve_grant` 不能覆寫 issuer；issuer 只來自 runtime／principal session。

`POST /api/mydata/fetch`

```
Authorization: Bearer Grant G-yi
{ "fields": ["household.householdId"], "actor": "agency-yi" }
```

HTTP 標頭必須是 ASCII，所以匣 G-甲／G-乙 在線上是 `G-jia`／`G-yi`。畫面與稽核仍顯示 G-甲、G-乙。匣 G-乙 只允許台電欄位，所以上面這包會 403。甲若帶 `actor: agency-jia` 用乙匣也會 403（參數與 audience 不符）。

## MCP（Grok Bot / Cursor 用 stdio）

Grok Bot 與 Cursor 用 **stdio** 連這台 MCP，**不要走 HTTP**。HTTP 只是本機選用。

模型永遠看不到金庫。工具只回欄位 ID、狀態、稽核；值由授權層寫進機關收件匣。

```bash
npx tsx mcp/server.ts
# 或
npm run mcp
```

Cursor / Grok Bot `mcp.json`（`cwd` 設成 repo 根目錄）：

```json
{
  "mcpServers": {
    "grantonce": {
      "command": "npx",
      "args": ["tsx", "mcp/server.ts"],
      "cwd": "/absolute/path/to/GrantOnce",
      "env": {
        "GRANTONCE_STORE": "/tmp/grantonce-runtime.json"
      }
    }
  }
}
```

`GRANTONCE_STORE` 可省略（預設 `/tmp/grantonce-runtime.json`）。沒有 API key、沒有 secrets。

工具：

| 工具 | 做什麼 |
| --- | --- |
| `plan_applications` | 規則引擎列出 G-甲／G-乙；建議匣帶 session 的 issuer + audience |
| `approve_grant` | 核准一匣；issuer 不可由工具參數覆寫 |
| `fetch_field` | 依匣擷取。參數 `actor` 要比對 audience。乙要戶籍 → 403 |
| `submit_application` | 參數 `actor` 要比對 audience。送件即耗用；重放擷取 403 |
| `revoke_grant` | 呼叫端必須是 issuer，否則 403 + 稽核 |
| `get_audit` | 時間線；所得從未進入任何匣 |

快樂路徑測試：`npm run test:mcp`

選用 HTTP（Streamable HTTP，預設 `127.0.0.1:43128/mcp`）：

```bash
npm run mcp:http
```
