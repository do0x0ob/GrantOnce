import { CardHead } from "@/components/agent/card-head";
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[12px] leading-5 text-stone-400">請求機關</p>
          <p className="mt-1 text-[14px] leading-6 text-stone-700">{request.requesterName}</p>
        </div>
        <div>
          <p className="text-[12px] leading-5 text-stone-400">資料來源機關</p>
          <p className="mt-1 text-[14px] leading-6 text-stone-700">
            {request.dataSources.map((source) => source.name).join("、")}
          </p>
        </div>
      </div>

      <div className="border-t border-stone-900/5 pt-4">
        <p className="text-[12px] leading-5 text-stone-400">本次最小需求</p>
        <ul className="mt-2 space-y-2">
          {request.claims.map((claim) => (
            <li key={claim.claimId} className="flex items-baseline justify-between gap-4 text-[14px] leading-6">
              <span className="text-stone-700">{claim.label}</span>
              <span className="shrink-0 text-[12px] text-stone-400">{claim.shape}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-[13px] leading-6 text-stone-500">
        這只是服務需求，不是授權，現在還沒有任何可簽署的匣。你確認之後，系統才會檢查這個機關有沒有權力要這些；
        通過了才鑄出匣給你簽，簽了資料來源機關才驗證並直接交付。語言模型全程不接收資料內容。
      </p>
    </section>
  );
}
