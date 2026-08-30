/**
 * MCP smoke test. Asserts the two invariants the tools must never break:
 * the model never sees a vault value, and the model can never sign a grant.
 */
import { keyPairFromSeed, sign, b64u } from "../lib/crypto";
import { makeAgencyProof, redeemGrant, registerPrincipalKey, signGrant } from "../lib/authz";
import { FLOOD_UTTERANCE } from "../lib/catalog";
import { upsertPurpose } from "../lib/registry-io";
import { getState, mutate, resetState } from "../lib/store";
import {
  callTool,
  claimValueLeakIn,
  claimValueMarkers,
  TOOL_NAMES,
  vaultLeakIn,
  type ToolName,
} from "./tools";

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

  console.log("\n主動推送");
  {
    // A wallet that actually holds a distinctive predicate value, so the
    // no-predicate-values invariant has something to catch.
    resetState();
    registerPrincipalKey({ publicKey: pk, method: "software" });
    await call("plan_applications", { utterance: "我剛搬家，看我能申請什麼。" });
    const jia = getState().grants.find((g) => g.id === "G-甲")!;
    signGrant({ grantId: "G-甲", signature: sign(jia.serialized, principal.secret), publicKey: pk });
    redeemGrant("G-甲", makeAgencyProof("jia", "G-甲"));
    check("皮夾裡有可辨識的述詞值可供比對", claimValueMarkers().includes("0-2"), claimValueMarkers().join(","));

    // Age the child out: now the agent has something to push without being asked.
    mutate((s) => {
      s.clockOffsetDays = 400;
    });

    const { data } = await call("get_notifications", {});
    const notes = data.notifications as { id: string; key: string; summary: string }[];
    check("回傳陣列且含 lastTickAt", Array.isArray(notes) && typeof data.lastTickAt === "string");
    check("推播不含金庫值", !vaultLeakIn(data));
    check("推播不含述詞值", !claimValueLeakIn(data), String(claimValueLeakIn(data)));
    check(
      "只回 summary，不回 body",
      notes.every((n) => typeof n.summary === "string") && !JSON.stringify(data).includes('"body"'),
    );
    check(
      "推播裡有「你現在符合托育補助」這種好消息",
      notes.some((n) => n.key === "eligibility:gained:childcare-service-subsidy"),
      notes.map((n) => n.key).join(","),
    );
    check(
      "人類版本的本文帶著述詞值，模型版本沒有",
      getState().notifications.some((n) => n.body.includes("0-2")) &&
        getState().notifications.every((n) => !n.summaryForAgent.includes("0-2")),
    );

    const first = notes.map((n) => n.key).sort();
    await call("get_notifications", {});
    const third = ((await call("get_notifications", {})).data.notifications as { key: string }[])
      .map((n) => n.key)
      .sort();
    check("連跑三次 tick，同一個 key 只出現一次", JSON.stringify(first) === JSON.stringify(third), third.join(","));
    check("沒有重複的 key", new Set(third).size === third.length, third.join(","));
  }

  console.log("\n述詞值混進推播時會被擋下");
  {
    // Without this the guard could be deleted and every other assertion would
    // still pass — nothing else in the suite ever produces a leaking payload.
    const band = claimValueMarkers()[0];
    mutate((s) => {
      s.notifications[0].summaryForAgent = `幼兒年齡帶已變成 ${band}`;
    });
    let refused = false;
    try {
      await callTool("get_notifications", {});
    } catch {
      refused = true;
    }
    check("述詞值混進 summary → 拒絕回傳", refused);
    mutate((s) => {
      s.notifications[0].summaryForAgent = "幼兒年齡帶已離開育兒津貼的適用範圍。";
    });
  }

  console.log("\nacknowledge_notification");
  {
    const before = (await call("get_notifications", { unacknowledgedOnly: true })).data
      .notifications as { id: string }[];
    const auditBefore = ((await call("get_audit")).data.audit as { action: string }[]).filter(
      (a) => a.action === "acknowledge",
    ).length;

    const { data } = await call("acknowledge_notification", { id: before[0].id });
    check("簽收成功", data.ok === true, JSON.stringify(data));

    const after = (await call("get_notifications", { unacknowledgedOnly: true })).data
      .notifications as { id: string }[];
    check(
      "簽收後 unacknowledgedOnly 不再回傳",
      !after.some((n) => n.id === before[0].id),
      after.map((n) => n.id).join(","),
    );
    check("unacknowledgedOnly 會過濾掉已簽收的", after.length === before.length - 1, `${before.length} → ${after.length}`);
    check(
      "簽收後全量仍看得到它",
      ((await call("get_notifications")).data.notifications as { id: string }[]).some(
        (n) => n.id === before[0].id,
      ),
    );

    const auditAfter = ((await call("get_audit")).data.audit as { action: string }[]).filter(
      (a) => a.action === "acknowledge",
    ).length;
    check("稽核多一筆 acknowledge", auditAfter === auditBefore + 1, `${auditBefore} → ${auditAfter}`);

    const unknown = await callTool("acknowledge_notification", { id: "ntf_nope" });
    check(
      "未知 id 回 ok:false 而不是丟錯",
      (unknown.data as { ok?: boolean }).ok === false && unknown.isError,
      JSON.stringify(unknown.data),
    );
  }

  console.log("\nget_pending_actions");
  {
    resetState();
    registerPrincipalKey({ publicKey: pk, method: "software" });
    await call("plan_applications", { utterance: "我剛搬家，看我能申請什麼。" });

    type Action = { id: string; blockedOn: string; grantId: string | null; suggestedTool: string | null };
    const pendingFor = async (grantId: string) =>
      ((await call("get_pending_actions")).data.actions as Action[]).filter(
        (a) => a.grantId === grantId,
      );

    check(
      "有 proposed 匣時 blockedOn 為 principal",
      (await pendingFor("G-甲")).every((a) => a.blockedOn === "principal"),
    );

    const grant = getState().grants.find((g) => g.id === "G-甲")!;
    signGrant({ grantId: "G-甲", signature: sign(grant.serialized, principal.secret), publicKey: pk });
    check(
      "簽署後 blockedOn 變成 agency",
      (await pendingFor("G-甲")).every((a) => a.blockedOn === "agency"),
      JSON.stringify(await pendingFor("G-甲")),
    );

    const all = (await call("get_pending_actions")).data.actions as Action[];
    const suggested = all.map((a) => a.suggestedTool).filter((t): t is string => Boolean(t));
    check(
      "suggestedTool 一定落在 TOOL_NAMES 內",
      suggested.every((t) => (TOOL_NAMES as readonly string[]).includes(t)),
      suggested.join(","),
    );
    check("不含金庫值也不含述詞值", !vaultLeakIn(all) && !claimValueLeakIn(all));

    // Not a name check: every suggested tool is actually run, from a signable
    // state, with arguments that would be accepted by a signing tool if one
    // existed. None of them can turn a capsule into a signed one, because the
    // tool that does that is not in the protocol at all.
    const couldSign: string[] = [];
    for (const tool of new Set(suggested)) {
      resetState();
      registerPrincipalKey({ publicKey: pk, method: "software" });
      await call("plan_applications", { utterance: "我剛搬家，看我能申請什麼。" });
      const bytes = getState().grants.find((g) => g.id === "G-甲")!.serialized;
      const action = ((await call("get_pending_actions")).data.actions as (Action & {
        suggestedArgs: Record<string, string>;
      })[]).find((a) => a.suggestedTool === tool);
      try {
        await callTool(tool as ToolName, {
          ...action?.suggestedArgs,
          signature: sign(bytes, principal.secret),
          publicKey: pk,
          bytesToSign: bytes,
        });
      } catch {
        // refusing the arguments is still not signing
      }
      if (getState().grants.some((g) => g.signature !== null)) couldSign.push(tool);
    }
    check("沒有任何 suggestedTool 會讓匣變成已簽署", couldSign.length === 0, couldSign.join(","));
  }

  console.log("\nget_audit 的增量");
  {
    const full = (await call("get_audit")).data as { audit: { id: string }[]; cursor: string | null };
    check("回傳 cursor", typeof full.cursor === "string" && full.cursor.length > 0, String(full.cursor));
    const midpoint = full.audit[0].id;
    const partial = (await call("get_audit", { since: midpoint })).data as { audit: unknown[] };
    check(
      "帶 since 後 entries 嚴格少於全量",
      partial.audit.length < full.audit.length,
      `${full.audit.length} → ${partial.audit.length}`,
    );
    const resumed = (await call("get_audit", { since: full.cursor! })).data as { audit: unknown[] };
    check("用 cursor 續讀就沒有新的了", resumed.audit.length === 0, String(resumed.audit.length));
    const nonsense = (await call("get_audit", { since: "不是時間也不是編號" })).data as {
      audit: unknown[];
      note: string;
    };
    check(
      "since 不合法時退回全量並說明",
      nonsense.audit.length === full.audit.length && nonsense.note.includes("已改回全量"),
      nonsense.note,
    );
  }

  console.log("\nstop_delegation");
  {
    const yi = getState().grants.find((g) => g.id === "G-乙")!;
    signGrant({ grantId: "G-乙", signature: sign(yi.serialized, principal.secret), publicKey: pk });
    const { data } = await call("stop_delegation", {});
    check("委託停用", data.delegationActive === false);
    const after = await call("redeem_grant", { grantId: "G-乙", agency: "yi" });
    check("停用後兌現被擋", after.data.ok === false, JSON.stringify(after.data));
    const pending = (await call("get_pending_actions")).data.actions as { blockedOn: string }[];
    check(
      "委託停用會出現在待辦裡，卡在委託人身上",
      pending.some((a) => a.blockedOn === "principal"),
      JSON.stringify(pending),
    );
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
