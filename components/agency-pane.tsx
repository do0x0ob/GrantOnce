"use client";

import { AuditTimeline } from "@/components/audit-timeline";
import { DenialBanner } from "@/components/denial-banner";
import { IdentityDot } from "@/components/identity-dot";
import { StatusChip } from "@/components/status-chip";
import { SURFACE } from "@/components/surface";
import { SENSITIVITY_TEXT } from "@/components/tone";
import { Button } from "@/components/ui/button";
import { PURPOSE_IDS, PURPOSES, type PurposeId } from "@/lib/purposes";
import { cn } from "@/lib/utils";
import type { Demo } from "@/hooks/use-demo";

/** Always refused: outside every purpose, and one of them is special-category. */
const OVERSCOPE_CLAIMS = ["raw.income.annual", "raw.household.address"];

/** A purpose belonging to a different agency, so presenting its capsule here is
 *  a genuine audience mismatch rather than a merely unsigned capsule. */
function otherAgencyPurpose(purposeId: PurposeId): PurposeId {
  const mine = PURPOSES[purposeId].agency;
  return PURPOSE_IDS.find((id) => PURPOSES[id].agency !== mine) ?? purposeId;
}

function InboxCard({ demo, purposeId }: { demo: Demo; purposeId: PurposeId }) {
  const purpose = PURPOSES[purposeId];
  const inbox = demo.view.inboxes[purposeId];
  const grant = demo.view.grants.find((g) => g.purpose === purposeId);
  const other = PURPOSES[otherAgencyPurpose(purposeId)];

  return (
    <article className={cn(SURFACE, "space-y-3 p-4")}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <IdentityDot tone={purpose.agency} />
            <p className="truncate text-[14px] leading-5 text-stone-800">{purpose.title}</p>
          </div>
          <p className="truncate text-[12px] leading-4 text-stone-400">
            {inbox.slot} · {inbox.name}
          </p>
        </div>
        {inbox.submittedAt ? (
          <StatusChip tone="mint">已送件</StatusChip>
        ) : inbox.receivedAt ? (
          <StatusChip tone="mint">已收件</StatusChip>
        ) : (
          <StatusChip tone="stone">空</StatusChip>
        )}
      </header>

      {inbox.claims.length ? (
        <ul className="space-y-1">
          {inbox.claims.map((claim) => (
            <li key={claim.claimId} className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] leading-5 text-stone-600">{claim.label}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span
                  className={cn("font-mono text-[12px] leading-5", SENSITIVITY_TEXT[claim.sensitivity])}
                >
                  {claim.value}
                </span>
                <span
                  className="text-[11px] leading-4 text-stone-400"
                  title={`由 ${claim.issuerName} 簽發`}
                >
                  {claim.issuerSignatureValid ? "簽章 ✓" : "簽章 ✗"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] leading-5 text-stone-400">
          {grant
            ? "尚未收到任何述詞。需要委託人簽章與本機關的持有證明同時成立。"
            : "目前沒有符合這個目的的申請案。"}
        </p>
      )}

      {inbox.grantDigest ? (
        <p className="font-mono text-[10px] leading-4 text-stone-400 break-all">
          憑匣摘要 {inbox.grantDigest}
        </p>
      ) : null}

      {inbox.lastDenial ? <DenialBanner reason={inbox.lastDenial} /> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="rounded-full"
          disabled={demo.busy || grant?.status !== "signed"}
          onClick={() => void demo.redeem(inbox.slot, purpose.agency)}
          title={grant?.status !== "signed" ? "需要一張已簽署且未兌現的匣" : undefined}
        >
          兌現本匣
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full text-stone-400 hover:text-stone-600"
          disabled={demo.busy || !inbox.receivedAt || Boolean(inbox.submittedAt)}
          onClick={() => void demo.submit(inbox.slot)}
        >
          送出申請
        </Button>
      </div>

      <div className="space-y-1.5 border-t border-stone-100 pt-2.5">
        <p className="text-[11px] leading-4 text-stone-400">試著越界</p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-[12px] text-rose-500 hover:bg-rose-50 hover:text-rose-600"
            disabled={demo.busy}
            onClick={() => void demo.redeem(other.slot, purpose.agency)}
          >
            拿{other.slot}來兌現
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-[12px] text-rose-500 hover:bg-rose-50 hover:text-rose-600"
            disabled={demo.busy}
            onClick={() => void demo.redeem(inbox.slot, purpose.agency)}
          >
            重放已兌現的匣
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-[12px] text-rose-500 hover:bg-rose-50 hover:text-rose-600"
            disabled={demo.busy}
            onClick={() => void demo.requestClaims(purpose.agency, purposeId, OVERSCOPE_CLAIMS)}
          >
            索取所得與地址
          </Button>
        </div>
      </div>
    </article>
  );
}

export function AgencyPane({ demo }: { demo: Demo }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0 space-y-1">
        <p className="text-[14px] leading-5 text-stone-800">機關收件匣</p>
        <p className="text-[12px] leading-5 text-stone-400">
          每個目的一個收件匣。機關要拿到東西，必須自己出示金鑰證明身分，而且該目的要在法定職務範圍內。
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {PURPOSE_IDS.map((id) => (
          <InboxCard key={id} demo={demo} purposeId={id} />
        ))}
        <AuditTimeline view={demo.view} />
      </div>
    </div>
  );
}
