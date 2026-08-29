"use client";

import { AuditTimeline } from "@/components/audit-timeline";
import { DenialBanner } from "@/components/denial-banner";
import { StatusChip } from "@/components/status-chip";
import { IdentityDot } from "@/components/identity-dot";
import { ProtocolInspector } from "@/components/protocol-inspector";
import { SURFACE } from "@/components/surface";
import { SENSITIVITY_TEXT } from "@/components/tone";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Demo } from "@/hooks/use-demo";
import type { AgencyId, GrantId } from "@/lib/types";

function InboxCard({
  demo,
  agency,
  grantId,
  overscope,
}: {
  demo: Demo;
  agency: AgencyId;
  grantId: GrantId;
  overscope: { purpose: string; claims: string[]; label: string };
}) {
  const inbox = demo.view.inboxes[agency];
  const grant = demo.view.grants.find((g) => g.id === grantId);
  const otherGrant: GrantId = agency === "jia" ? "G-乙" : "G-甲";
  const otherLabel = agency === "jia" ? "乙" : "甲";

  return (
    <article className={cn(SURFACE, "space-y-3 p-4")}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-2">
            <IdentityDot tone={agency} />
            <p className="truncate text-[14px] leading-5 text-stone-800">{inbox.name}</p>
          </div>
          <p className="truncate text-[12px] leading-4 text-stone-400">{inbox.programTitle}</p>
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
                  className={cn(
                    "font-mono text-[12px] leading-5",
                    SENSITIVITY_TEXT[claim.sensitivity],
                  )}
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
          尚未收到任何述詞。需要委託人簽章與本機關的持有證明同時成立。
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
          onClick={() => void demo.redeem(grantId, agency)}
          title={grant?.status !== "signed" ? "需要一張已簽署且未兌現的匣" : undefined}
        >
          兌現本匣
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full text-stone-400 hover:text-stone-600"
          disabled={demo.busy || !inbox.receivedAt || Boolean(inbox.submittedAt)}
          onClick={() => void demo.submit(grantId)}
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
            onClick={() => void demo.redeem(otherGrant, agency)}
          >
            拿{otherLabel}的匣來兌現
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-[12px] text-rose-500 hover:bg-rose-50 hover:text-rose-600"
            disabled={demo.busy}
            onClick={() => void demo.redeem(grantId, agency)}
          >
            重放已兌現的匣
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-[12px] text-rose-500 hover:bg-rose-50 hover:text-rose-600"
            disabled={demo.busy}
            onClick={() => void demo.requestClaims(agency, overscope.purpose, overscope.claims)}
          >
            {overscope.label}
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
          機關要拿到東西，必須自己出示金鑰證明身分，而且該目的要在法定職務範圍內。
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <InboxCard
          demo={demo}
          agency="jia"
          grantId="G-甲"
          overscope={{
            purpose: "childcare-allowance",
            claims: ["raw.income.annual", "raw.household.address"],
            label: "索取所得與地址",
          }}
        />
        <InboxCard
          demo={demo}
          agency="yi"
          grantId="G-乙"
          overscope={{
            purpose: "aircon-subsidy",
            claims: ["raw.household.householdId"],
            label: "索取戶號",
          }}
        />
        <AuditTimeline view={demo.view} />
      </div>
    </div>
  );
}
