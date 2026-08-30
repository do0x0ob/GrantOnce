/**
 * MCP smoke test. Asserts the two invariants the tools must never break:
 * the model never sees a vault value, and the model can never sign a grant.
 */
import { keyPairFromSeed, sign, b64u } from "../lib/crypto";
import { registerPrincipalKey, signGrant } from "../lib/authz";
import { FLOOD_UTTERANCE } from "../lib/catalog";
import { getState, resetState } from "../lib/store";
import { callTool, TOOL_NAMES, vaultLeakIn, type ToolName } from "./tools";

let pass = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name} ${extra}`);
  }
}

function call(name: ToolName, args: Record<string, unknown> = {}) {
  const { data, isError } = callTool(name, args);
  const leak = vaultLeakIn(data);
  if (leak) throw new Error(`${name} leaked ${leak}`);
  return { data: data as Record<string, unknown>, isError };
}

resetState();
const principal = keyPairFromSeed("mcp-test-principal");
const pk = b64u(principal.publicKey);
registerPrincipalKey({ publicKey: pk, method: "software" });

console.log("工具清單與實作一致");
{
  // Catches a tool registered on the server but not wired into callTool, and
  // vice versa — a mismatch that would surface only at runtime in a client.
  const unhandled = TOOL_NAMES.filter((name) => {
    try {
      const { data } = callTool(name, {});
      const error = (data as { error?: string }).error;
      return typeof error === "string" && error.startsWith("未知工具");
    } catch {
      // A tool that rejects empty arguments is wired up; only the default
      // branch of callTool reports an unknown tool.
      return false;
    }
  });
  check("每個工具都有實作", unhandled.length === 0, unhandled.join(","));
}

console.log("\nsearch_purposes");
{
  resetState();
  registerPrincipalKey({ publicKey: pk, method: "software" });
  const flood = call("search_purposes", { query: FLOOD_UTTERANCE });
  const matches = flood.data.matches as { id: string; issuable: boolean }[];
  check("水災命中目錄", matches.some((m) => m.id === "flood-relief"));
  check(
    "水災標記不可發票",
    matches.some((m) => m.id === "flood-relief" && m.issuable === false),
  );
  check("搜尋不讀金庫", !vaultLeakIn(flood.data));
  check("搜尋不建匣", getState().grants.length === 0);
}

console.log("\nplan_applications");
{
  resetState();
  registerPrincipalKey({ publicKey: pk, method: "software" });
  const flood = call("plan_applications", { utterance: FLOOD_UTTERANCE });
  check("水災不發票", flood.data.canIssue === false);
  check(
    "水災不建匣",
    getState().grants.length === 0,
    JSON.stringify(getState().grants.map((g) => g.id)),
  );
  check(
    "水災回目錄",
    Array.isArray(flood.data.catalog) &&
      (flood.data.catalog as { id: string }[]).some((e) => e.id === "flood-relief"),
  );
  check("水災回傳不含金庫值", !vaultLeakIn(flood.data));

  resetState();
  registerPrincipalKey({ publicKey: pk, method: "software" });
  const { data } = call("plan_applications", { utterance: "我剛搬家，看我能申請什麼。" });
  check("回傳兩個申請案", Array.isArray(data.programs) && (data.programs as unknown[]).length === 2);
  check("搬家路徑 canIssue", data.canIssue === true);
  check("只回述詞 ID 與標籤，無金庫值", !vaultLeakIn(data));
}

console.log("\nget_grant_for_signature");
{
  const { data } = call("get_grant_for_signature", { grantId: "G-甲" });
  check("提供待簽 bytes", typeof data.bytesToSign === "string");
  check("提供同意畫面文字", String(data.consentText).includes("法定依據"));
  check("明講模型不能代簽", String(data.note).includes("不能代簽"));
}

console.log("\n模型無法簽署");
{
  // The invariant is behavioural, not a name check. Each tool is tried from a
  // clean, signable state and handed a signature that would be accepted, so a
  // destructive tool earlier in the list cannot mask a signing tool later in it.
  const couldSign: string[] = [];
  for (const name of TOOL_NAMES) {
    resetState();
    registerPrincipalKey({ publicKey: pk, method: "software" });
    call("plan_applications", { utterance: "我剛搬家，看我能申請什麼。" });
    const bytes = getState().grants.find((g) => g.id === "G-甲")!.serialized;
    try {
      callTool(name, {
        utterance: "我剛搬家，看我能申請什麼。",
        grantId: "G-甲",
        agency: "jia",
        purpose: "childcare-allowance",
        claims: ["resident.inNewTaipei"],
        reason: "test",
        signature: sign(bytes, principal.secret),
        publicKey: pk,
        bytesToSign: bytes,
      });
    } catch {
      // a tool that rejects these arguments is still a tool that did not sign
    }
    if (getState().grants.some((g) => g.signature !== null)) couldSign.push(name);
  }
  check("沒有任何工具能讓匣變成已簽署", couldSign.length === 0, couldSign.join(","));

  resetState();
  registerPrincipalKey({ publicKey: pk, method: "software" });
  call("plan_applications", { utterance: "我剛搬家，看我能申請什麼。" });
  const { data } = call("redeem_grant", { grantId: "G-甲", agency: "jia" });
  check("未簽的匣兌現失敗", data.ok === false && data.code === "UNSIGNED", JSON.stringify(data));
}

console.log("\n兌現（委託人簽署後）");
{
  const grant = getState().grants.find((g) => g.id === "G-甲")!;
  signGrant({ grantId: "G-甲", signature: sign(grant.serialized, principal.secret), publicKey: pk });
  const { data } = call("redeem_grant", { grantId: "G-甲", agency: "jia" });
  check("兌現成功", data.ok === true, JSON.stringify(data));
  check("只回述詞 ID，不回值", !("values" in data) && Array.isArray(data.claimIds));
}

console.log("\n跨機關與重放");
{
  const grant = getState().grants.find((g) => g.id === "G-乙")!;
  signGrant({ grantId: "G-乙", signature: sign(grant.serialized, principal.secret), publicKey: pk });
  const wrong = call("redeem_grant", { grantId: "G-乙", agency: "jia" });
  check("甲兌現乙的匣 → WRONG_AUDIENCE", wrong.data.code === "WRONG_AUDIENCE", JSON.stringify(wrong.data));
  const replay = call("redeem_grant", { grantId: "G-甲", agency: "jia" });
  check("重放 → REPLAYED", replay.data.code === "REPLAYED", JSON.stringify(replay.data));
}

console.log("\nrequest_claims 攔截");
{
  const { data } = call("request_claims", {
    agency: "jia",
    purpose: "childcare-allowance",
    claims: ["raw.income.annual"],
  });
  check("索取所得被攔截", data.blocked === true);
  check("理由含法定職務範圍", JSON.stringify(data.notes).includes("§15"));
}

console.log("\nget_audit");
{
  const { data } = call("get_audit");
  check("稽核有紀錄", Array.isArray(data.audit) && (data.audit as unknown[]).length > 0);
  check("皮夾只回 metadata 不回值", JSON.stringify(data.wallet).indexOf('"value"') === -1);
  check("列出從未使用的金庫欄位", Array.isArray(data.vaultFieldsNeverUsed));
}

console.log("\nstop_delegation");
{
  const { data } = call("stop_delegation", {});
  check("委託停用", data.delegationActive === false);
  const after = call("redeem_grant", { grantId: "G-乙", agency: "yi" });
  check("停用後兌現被擋", after.data.ok === false, JSON.stringify(after.data));
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("failed:", failures.join(", "));
  process.exit(1);
}
