/**
 * MCP smoke test. Asserts the two invariants the tools must never break:
 * the model never sees a vault value, and the model can never sign a grant.
 */
import { keyPairFromSeed, sign, b64u } from "../lib/crypto";
import { registerPrincipalKey, signGrant } from "../lib/authz";
import { FLOOD_UTTERANCE } from "../lib/catalog";
import { upsertPurpose } from "../lib/registry-io";
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

async function call(name: ToolName, args: Record<string, unknown> = {}) {
  const { data, isError } = await callTool(name, args);
  const leak = vaultLeakIn(data);
  if (leak) throw new Error(`${name} leaked ${leak}`);
  return { data: data as Record<string, unknown>, isError };
}

async function main() {
  resetState();
  const principal = keyPairFromSeed("mcp-test-principal");
  const pk = b64u(principal.publicKey);
  registerPrincipalKey({ publicKey: pk, method: "software" });

  console.log("工具清單與實作一致");
  {
    const unhandled: string[] = [];
    for (const name of TOOL_NAMES) {
      try {
        const { data } = await callTool(name, {});
        const error = (data as { error?: string }).error;
        if (typeof error === "string" && error.startsWith("未知工具")) unhandled.push(name);
      } catch {
        // A tool that rejects empty arguments is wired up.
      }
    }
    check("每個工具都有實作", unhandled.length === 0, unhandled.join(","));
  }

  console.log("\nsearch_purposes");
  {
    resetState();
    registerPrincipalKey({ publicKey: pk, method: "software" });
    const flood = await call("search_purposes", { query: FLOOD_UTTERANCE });
    const matches = flood.data.matches as { id: string; issuable: boolean }[];
    const world = flood.data.world as { source?: string; findings?: { title: string; url: string }[] };
    check("水災標出可發票子集", matches.some((m) => m.id === "flood-relief"));
    check(
      "水災不能 mint",
      matches.some((m) => m.id === "flood-relief" && m.issuable === false),
    );
    check("回傳公開搜尋區塊", Boolean(world && world.source));
    check(
      "公開搜尋不是把登記表當成全世界",
      String(flood.data.note).includes("不要把登記表當成全世界"),
    );
    const blob = JSON.stringify(world.findings ?? []);
    if ((world.findings?.length ?? 0) > 0) {
      check("水災公開條目跟災害／救助有關", /救助|災害|水災|慰助|社會/.test(blob), blob.slice(0, 240));
    } else {
      check("公開搜尋失敗時不假裝沒有這筆補助", world.source === "unavailable" || world.source === "disabled");
    }
    check("搜尋不讀金庫", !vaultLeakIn(flood.data));
    check("搜尋不建匣", getState().grants.length === 0);

    upsertPurpose({
      id: "move-bonus",
      title: "遷入獎勵",
      agency: "jia",
      legalBasis: ["個人資料保護法 §15 第 1 款：執行法定職務必要範圍"],
      allowedClaims: ["resident.inNewTaipei", "resident.movedWithin12m"],
      maxTtlSeconds: 600,
      necessity: "只要確認設籍本市與一年內遷入，不需要地址本身。",
    });
    const hung = await call("search_purposes", { query: "遷入獎勵" });
    const hungMatches = hung.data.matches as { id: string; issuable: boolean }[];
    check(
      "登記台掛上的目的會進可發票子集",
      hungMatches.some((m) => m.id === "move-bonus" && m.issuable),
      JSON.stringify(hungMatches.map((m) => m.id)),
    );
  }

  console.log("\nplan_applications");
  {
    resetState();
    registerPrincipalKey({ publicKey: pk, method: "software" });
    const flood = await call("plan_applications", { utterance: FLOOD_UTTERANCE });
    check("水災不發票", flood.data.canIssue === false);
    check(
      "水災不建匣",
      getState().grants.length === 0,
      JSON.stringify(getState().grants.map((g) => g.id)),
    );
    check(
      "水災仍標出尚未綁定的目的",
      Array.isArray(flood.data.catalog) &&
        (flood.data.catalog as { id: string }[]).some((e) => e.id === "flood-relief"),
    );
    check("水災回傳公開搜尋", Boolean((flood.data.world as { source?: string } | null)?.source));
    check("水災回傳不含金庫值", !vaultLeakIn(flood.data));

    resetState();
    registerPrincipalKey({ publicKey: pk, method: "software" });
    const { data } = await call("plan_applications", { utterance: "我剛搬家，看我能申請什麼。" });
    check("回傳兩個申請案", Array.isArray(data.programs) && (data.programs as unknown[]).length === 2);
    check("搬家路徑 canIssue", data.canIssue === true);
    check("只回述詞 ID 與標籤，無金庫值", !vaultLeakIn(data));
  }

  console.log("\nget_grant_for_signature");
  {
    const { data } = await call("get_grant_for_signature", { grantId: "G-甲" });
    check("提供待簽 bytes", typeof data.bytesToSign === "string");
    check("提供同意畫面文字", String(data.consentText).includes("法定依據"));
    check("明講模型不能代簽", String(data.note).includes("不能代簽"));
  }

  console.log("\n模型無法簽署");
  {
    const couldSign: string[] = [];
    for (const name of TOOL_NAMES) {
      resetState();
      registerPrincipalKey({ publicKey: pk, method: "software" });
      await call("plan_applications", { utterance: "我剛搬家，看我能申請什麼。" });
      const bytes = getState().grants.find((g) => g.id === "G-甲")!.serialized;
      try {
        await callTool(name, {
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
    await call("plan_applications", { utterance: "我剛搬家，看我能申請什麼。" });
    const { data } = await call("redeem_grant", { grantId: "G-甲", agency: "jia" });
    check("未簽的匣兌現失敗", data.ok === false && data.code === "UNSIGNED", JSON.stringify(data));
  }

  console.log("\n兌現（委託人簽署後）");
  {
    const grant = getState().grants.find((g) => g.id === "G-甲")!;
    signGrant({ grantId: "G-甲", signature: sign(grant.serialized, principal.secret), publicKey: pk });
    const { data } = await call("redeem_grant", { grantId: "G-甲", agency: "jia" });
    check("兌現成功", data.ok === true, JSON.stringify(data));
    check("只回述詞 ID，不回值", !("values" in data) && Array.isArray(data.claimIds));
  }

  console.log("\n跨機關與重放");
  {
    const grant = getState().grants.find((g) => g.id === "G-乙")!;
    signGrant({ grantId: "G-乙", signature: sign(grant.serialized, principal.secret), publicKey: pk });
    const wrong = await call("redeem_grant", { grantId: "G-乙", agency: "jia" });
    check("甲兌現乙的匣 → WRONG_AUDIENCE", wrong.data.code === "WRONG_AUDIENCE", JSON.stringify(wrong.data));
    const replay = await call("redeem_grant", { grantId: "G-甲", agency: "jia" });
    check("重放 → REPLAYED", replay.data.code === "REPLAYED", JSON.stringify(replay.data));
  }

  console.log("\nrequest_claims 攔截");
  {
    const { data } = await call("request_claims", {
      agency: "jia",
      purpose: "childcare-allowance",
      claims: ["raw.income.annual"],
    });
    check("索取所得被攔截", data.blocked === true);
    check("理由含法定職務範圍", JSON.stringify(data.notes).includes("§15"));
  }

  console.log("\nget_audit");
  {
    const { data } = await call("get_audit");
    check("稽核有紀錄", Array.isArray(data.audit) && (data.audit as unknown[]).length > 0);
    check("皮夾只回 metadata 不回值", JSON.stringify(data.wallet).indexOf('"value"') === -1);
    check("列出從未使用的金庫欄位", Array.isArray(data.vaultFieldsNeverUsed));
  }

  console.log("\nstop_delegation");
  {
    const { data } = await call("stop_delegation", {});
    check("委託停用", data.delegationActive === false);
    const after = await call("redeem_grant", { grantId: "G-乙", agency: "yi" });
    check("停用後兌現被擋", after.data.ok === false, JSON.stringify(after.data));
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("failed:", failures.join(", "));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
