# GrantOnce 分匣授權

只准這一次，而且只准這一匣。

委託人核准最小欄位授權匣，runtime 發出 **HMAC ticket**。之後 fetch／submit **只認這張票**，不認匣號、也不認呼叫端自報的身分。每個機關只看得到自己那一匣。送件後授權立刻耗用。越權請求直接 403。

GrantOnce 是一套小而通用的授權協定（與哪個助手／MCP 宿主無關）。演示 UI 只是 harness。

**能力憑證是 ticket，不是匣號 G-甲／G-乙。** HMAC 金鑰只留在 runtime，不是工具參數，也不畫在匣卡上。

## 怎麼跑

1. `npm install`
2. `npm run dev`
3. 打開終端機印出的網址（預設 `http://127.0.0.1:43127`）

需要 Node 20+。沒有資料庫、沒有真實 MyData。可選環境變數 `GRANTONCE_HMAC_KEY`（未設時用演示用金鑰，只存在行程內）。

## 90 秒演示腳本

預設委託人是合成身分 **林曉晴**（臺北市 → 新北市，家中有一歲幼兒）。

1. 左欄點「演示這句」，或自己打：`我剛搬家，看我能申請什麼。`
2. 代理人列出兩個申請案與原因：
   - 育兒津貼 → 機關甲（新北市社會局）：只要戶籍＋親子關係
   - 冷氣汰換補助 → 機關乙（經濟部 × 台電）：只要電表號＋近三月用電
   - 會出現個人化提示：孩子滿 2 歲後，育兒津貼條件會改變
3. 左欄出現兩張匣。分別按「核准這一匣」。**沒有「一次交出全部資料」按鈕。** 核准後 runtime 發票；匣卡不顯示密鑰。
4. 授權層用票向假 MyData 擷取。右欄甲、乙收件匣欄位不同。所得不會出現。
5. 右欄乙按「索取戶籍謄本」→ 乙卡與協定檢視器出現 403 `OVERSCOPED`。
6. 乙按「用匣號 G-甲」→ 403 `BAD_TICKET`（匣號不是票）。甲按「索取用電量」或「用匣號 G-乙」同樣 403。
7. 右欄甲按「送出申請」→ 匣 `G-甲` 變成已耗用；收件匣改留雜湊收據，明文消失；ticket 失效。
8. 甲按「重放擷取」→ 再次 403。
9. 看稽核時間線：核准、擷取、送件、收據、撤銷、拒絕。標題列「對照胖授權」可切換 fields:* 反事實。

重來：右上「重設演示」。

## 簡報與錄影

- 12 頁：`pitch/GrantOnce.pptx`（大綱 `pitch/slides.md`）
- 協定兩頁：`docs/protocol.md`
- 3–5 分鐘畫面腳本：`pitch/demo-script.md`

## 什麼是假的

- 林曉晴、子女、地址、戶號、所得、健保、電表、用電量：全部合成
- MyData 金庫：本地 JSON，不是真實個人資料服務
- 社會局／經濟部／台電收件：畫面模擬，沒有真正送件
- 送件成功：只改授權狀態，不會把資料送到任何機關
- HMAC 金鑰：演示預設值，非正式金鑰管理

## 什麼是真的（在這個演示裡）

- **規則引擎**決定資格：搬家 + 0–2 歲幼兒 → 育兒津貼；有住宅電表 → 冷氣補助。模型不決定授權。
- **HMAC ticket** 才是能力憑證：核准後由 runtime 簽發，綁 `iss`／`aud`／`fields`／`exp`。runtime 驗票；代理人不能自報身分。
- 越權、用匣號當票、或已耗用：fail closed，不回傳部分欄位
- 所得在金庫裡，快樂路徑不會進入任何匣
- 送件後收件匣只留雜湊收據

OID4VP／MyData 登入是下一層，本週末不做。身分登入不交給代理人。

## 畫面三欄

| 欄 | 做什麼 |
| --- | --- |
| 匣 | 左上「演示這句」觸發器、兩張匣卡（核准／撤銷） |
| 金庫 | 假 MyData；所得留在這裡，不進任何匣 |
| 機關 | 甲／乙收件、403 芯片、協定檢視器、稽核時間線 |

## 授權協定

每個 Grant 都是：

| 欄位 | 意思 |
| --- | --- |
| `id` | 匣編號（**不是**能力憑證） |
| `issuer` | 誰核准（人／法院／機構的 principal id，不可硬編姓名） |
| `subject` | 金庫列是誰的資料 |
| `audience` | 誰可以使用這張匣；寫進 HMAC ticket |
| `purpose` | 用途 |
| `fields[]` | 白名單，沒有 `*` |
| `source` | `mydata` \| `wallet` \| `user` |
| `expiresAt` | 過期時間；寫進 HMAC ticket |
| `status` | `pending` \| `active` \| `consumed` \| `revoked` |
| `revokeOn` | `submitted` \| `user` \| `expired` |

`approve_grant` 之後 runtime 發出 HMAC ticket（`grn_<jti>.<mac>`）。`fetch_field` 與 `submit_application` **只接受 ticket**（ticket id 或 `Authorization: Bearer Grant grn_…`）。**沒有 `actor` 參數。** 匣號、自報身分都不是憑證。

HMAC 金鑰只在 runtime（`GRANTONCE_HMAC_KEY`）。不是 tool 參數，匣卡不畫金鑰、不畫完整 ticket。

`revoke_grant` 必須由 session 的 `issuer` 撤銷。工具不能自報 caller。

`POST /api/mydata/fetch`

```
Authorization: Bearer Grant <ticket>
{ "fields": ["household.householdId"] }
```

HTTP 標頭必須是 ASCII，所以匣 G-甲／G-乙 在線上若被誤當票來傳是 `G-jia`／`G-yi`，會 403 `BAD_TICKET`。畫面與稽核仍顯示 G-甲、G-乙。匣 G-乙 的票只允許台電欄位，帶戶籍欄位會 403 `OVERSCOPED`。

## MCP（Grok Bot / Cursor 用 stdio）

Grok Bot 與 Cursor 用 **stdio** 連這台 MCP，**不要走 HTTP**。HTTP 只是本機選用。

模型永遠看不到金庫。工具只回欄位 ID、狀態、稽核；值由授權層寫進機關收件匣。`approve_grant` 回傳 ticket，不回金庫值、不回 HMAC 金鑰。

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

`GRANTONCE_STORE` 可省略（預設 `/tmp/grantonce-runtime.json`）。沒有把 HMAC 金鑰當成工具參數。

工具：

| 工具 | 做什麼 |
| --- | --- |
| `plan_applications` | 規則引擎列出 G-甲／G-乙；建議匣帶 session 的 issuer + audience |
| `approve_grant` | 核准一匣；runtime 發出 HMAC ticket。issuer 不可由工具參數覆寫 |
| `fetch_field` | 只認 ticket。乙票要戶籍 → 403。沒有 `actor` |
| `submit_application` | 只認 ticket。送件即耗用；票失效；重放擷取 403 |
| `revoke_grant` | 由 session issuer 撤銷，否則 403 + 稽核 |
| `get_audit` | 時間線；所得從未進入任何匣 |

快樂路徑測試：`npm test`（授權性質 + MCP）

選用 HTTP（Streamable HTTP，預設 `127.0.0.1:43128/mcp`）：

```bash
npm run mcp:http
```
