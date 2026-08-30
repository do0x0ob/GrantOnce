import { CardHead } from "@/components/agent/card-head";
import { DataFlowDiagram } from "@/components/agent/data-flow-diagram";
import { SURFACE } from "@/components/surface";
import type { PurposeId } from "@/lib/purposes";
import { cn } from "@/lib/utils";
import type { PrincipalView } from "@/lib/view";

export function ServiceRequirementCard({
  purpose,
  view,
}: {
  purpose: PurposeId;
  view: PrincipalView;
}) {
  const request = [...view.serviceRequests]
    .reverse()
    .find((item) => item.purpose === purpose && item.status !== "cancelled");

  if (!request) return null;

  return (
    <section className={cn(SURFACE, "space-y-5 px-6 py-5")}>
      <CardHead title="服務回傳的必要資料" sub={`${request.title} · ${request.requesterName}`} />

      <DataFlowDiagram
        requesterName={request.requesterName}
        sourceNames={request.dataSources.map((source) => source.name)}
        claimCount={request.claims.length}
      />

      <div className="border-t border-stone-900/5 pt-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[12px] leading-5 text-stone-400">本次最小需求</p>
          {/* The subtraction, not just the result: a request that always equals
              the registry cap is a well-chosen maximum, not minimisation. */}
          <p className="text-[12px] leading-5 text-stone-400">
            登記上限 {request.ceilingCount} 項
            {request.alreadyHeld.length ? ` · 已持有 ${request.alreadyHeld.length} 項` : ""}
            {" · "}
            <span className="text-stone-600">本次要 {request.claims.length} 項</span>
          </p>
        </div>

        <ul className="mt-2 space-y-2.5">
          {request.claims.map((claim) => (
            <li key={claim.claimId} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-4 text-[14px] leading-6">
                <span className="text-stone-700">{claim.label}</span>
                <span className="shrink-0 text-[12px] text-stone-400">{claim.shape}</span>
              </div>
              {claim.derivedFrom.length ? (
                <p className="text-[12px] leading-5 text-stone-400">
                  由「{claim.derivedFrom.join("、")}」算出，原始欄位留在金庫
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        {request.alreadyHeld.length ? (
          <div className="mt-4 border-t border-stone-900/5 pt-3">
            <p className="text-[12px] leading-5 text-stone-400">沒有再跟你要（機關已持有，仍在效期內）</p>
            <p className="mt-1 text-[13px] leading-6 text-stone-600">
              {request.alreadyHeld.map((claim) => claim.label).join("、")}
            </p>
          </div>
        ) : null}
      </div>

      <p className="text-[13px] leading-6 text-stone-500">
        這只是服務需求，不是授權，現在還沒有任何可簽署的匣。你確認之後，系統才會檢查這個機關有沒有權力要這些；
        通過了才鑄出匣給你簽，簽了資料來源機關才驗證並直接交付。語言模型全程不接收資料內容。
      </p>
    </section>
  );
}
