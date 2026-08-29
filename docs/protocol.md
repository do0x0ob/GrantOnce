# GrantOnce 協定（兩頁）

週末演示規格。合成資料。非正式 MyData。

**HMAC ticket 才是能力憑證。** 匣號不是。OID4VP／MyData 登入是下一層，本週末不做；身分登入不交給代理人。

## 1. 生命週期與錯誤碼

Grant 描述允許什麼；ticket 才讓 runtime 放行。

```
pending → active（發票） → consumed | revoked（銷票）
```

核准時 runtime 用行程內 HMAC 金鑰簽：

```
canonical = { jti, grantId, iss, aud, fields[], exp }
token     = jti + "." + HMAC-SHA256(canonical)
```

`jti` 是不透明的 `grn_…`。金鑰不是工具參數，不畫在匣卡上。

擷取／送件：

```
POST /api/mydata/fetch
Authorization: Bearer Grant <ticket id 或 grn_….<mac>>
{ "fields": ["taipower.meterId"] }
```

沒有 `actor`。runtime 驗 MAC 與欄位白名單；不信代理人自報身分。

| 狀況 | 代碼 | HTTP |
| --- | --- | --- |
| 缺票、匣號、MAC 錯、未知 jti | `BAD_TICKET` | 403 |
| `fields:*` 或 `*` | `WILDCARD_FORBIDDEN` | 403 |
| 欄位不在票內白名單（乙要戶籍、甲要電號） | `OVERSCOPED` | 403 |
| 未核准／已耗用／過期 | `GRANT_INACTIVE` | 403 |
| 撤銷者不是 issuer | `ISSUER_MISMATCH` | 403 |

Fail-closed：越權不回傳半包欄位。模型工具只回欄位 ID，不回金庫值。

送件：匣 `consumed`，收件匣清空明文，改留收據 `{ grantJti, fieldIds, sha256(values), submittedAt }`，ticket 從 runtime 刪除。重放擷取 → 403。

## 2. 對照：為什麼不是再包一層 OAuth

| | 胖 token | OAuth 粗範圍 | 台灣 MyData | GrantOnce |
| --- | --- | --- | --- | --- |
| 同意單位 | 一次全交 | scope 字串 | 對**一個**服務單次同意 | **一場對話、多個機關、每機關一匣** |
| 機關互看 | 都會看到 | 常聯集 | 原則上一次一個服務 | 票綁 audience＋fields，匣號當票 403 |
| 用完 | 影本留窗口 | refresh 仍在 | 單次、用完刪 | 送件 → 收據，明文刪，票失效 |
| 代理人 | 模型拿得到值 | 資源伺服器不管模型 | 人自己點 | 模型看不到金庫；不能自報身分；MCP 不能覆寫 issuer |

下一步：真 MyData 要數發部函。OID4VP／登入綁人。同一套 `iss`／`aud` 以後可換簽發人（法院／搜索票），本週末不演示。
