# GrantOnce 協定（兩頁）

週末演示規格。合成資料。非正式 MyData。Passkey／登入由隊友接；本檔只定義匣。

## 1. 生命週期與錯誤碼

Grant 是能力憑證，不是聊天同意。

```
proposed → active → consumed | revoked
```

Claims（passkey 隊友簽這個物件）：

```
{ jti, iss, aud, purpose, fields[], nbf, exp, use: "once" }
```

目前 `signature.alg = unsigned-demo`。接上後只換驗簽，不改 aud／fields 檢查。

擷取：

```
POST /api/mydata/fetch
Authorization: Bearer Grant <jti>
X-GrantOnce-Presenter: agency-jia | agency-yi
{ "fields": ["taipower.meterId"] }
```

Presenter 來自機關櫃檯標頭，**不是** body 裡的 `actor`，也**不能**寫進 `grant.aud`。

| 狀況 | 代碼 | HTTP |
| --- | --- | --- |
| `fields:*` 或 `*` | `WILDCARD_FORBIDDEN` | 403 |
| presenter ≠ `claims.aud`，或甲讀乙收件匣 | `AUDIENCE_MISMATCH` | 403 |
| 欄位不在白名單（乙要戶籍、甲要電號） | `OVERSCOPED` | 403 |
| 未核准／已耗用／過期 | `GRANT_INACTIVE` | 403 |
| 未知 jti | `UNKNOWN_GRANT` | 403 |

Fail-closed：越權不回傳半包欄位。模型工具只回欄位 ID，不回金庫值。

送件：匣 `consumed`，收件匣清空明文，改留收據 `{ grantJti, fieldIds, sha256(values), submittedAt }`。重放擷取 → `GRANT_INACTIVE`。

## 2. 對照：為什麼不是再包一層 OAuth

| | 胖 token | OAuth 粗範圍 | 台灣 MyData | GrantOnce |
| --- | --- | --- | --- | --- |
| 同意單位 | 一次全交 | scope 字串 | 對**一個**服務單次同意 | **一場對話、多個機關、每機關一匣** |
| 機關互看 | 都會看到 | 常聯集 | 原則上一次一個服務 | audience 綁定，拿錯匣 403 |
| 用完 | 影本留窗口 | refresh 仍在 | 單次、用完刪 | 送件 → 收據，明文刪 |
| 代理人 | 模型拿得到值 | 資源伺服器不管模型 | 人自己點 | 模型看不到金庫；MCP 不能核准 |

下一步：真 MyData 要數發部函。claims 由 passkey 簽。同一套 `iss`／`aud` 以後可換簽發人（法院／搜索票），本週末不演示。
