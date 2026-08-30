"use client";

import { useState } from "react";
import { AuditTimeline } from "@/components/audit-timeline";
import { DenialBanner } from "@/components/denial-banner";
import { PageIntro } from "@/components/page-intro";
import { StatusChip } from "@/components/status-chip";
import { SURFACE } from "@/components/surface";
import { SENSITIVITY_TEXT } from "@/components/tone";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Demo } from "@/hooks/use-demo";
import type { AgencyId, GrantId } from "@/lib/types";

const DESKS: {
  agency: AgencyId;
  grantId: GrantId;
  short: string;
  overscope: { purpose: string; claims: string[]; label: string };
}[] = [
  {
    agency: "jia",
    grantId: "G-甲",
    short: "社會局",
    overscope: {
      purpose: "childcare-allowance",
      claims: ["raw.income.annual", "raw.household.address"],
      label: "索取所得與地址",
    },
  },
  {
    agency: "yi",
    grantId: "G-乙",
    short: "經濟部",
    overscope: {
      purpose: "aircon-subsidy",
      claims: ["raw.household.householdId"],
      label: "索取戶號",
    },
  },
];

function InboxDesk({
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
  const canRedeem = grant?.status === "signed";

  return (
    <article className={cn(SURFACE, "space-y-8 p-7 sm:p-9")}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <h2 className="text-[22px] font-medium leading-7 tracking-tight text-stone-900">
            {inbox.programTitle}
          </h2>
          <p className="text-[14px] leading-5 text-stone-400">{inbox.name}</p>
        </div>
        {inbox.submittedAt ? (
          <StatusChip tone="mint">已送件</StatusChip>
        ) : inbox.receivedAt ? (
          <StatusChip tone="mint">已收件</StatusChip>
        ) : (
          <StatusChip tone="stone">等待兩把鑰匙</StatusChip>
        )}
      </header>

      {inbox.claims.length ? (
        <ul className="space-y-5">
          {inbox.claims.map((claim) => (
            <li key={claim.claimId} className="flex items-baseline justify-between gap-4">
              <span className="text-[15px] leading-6 text-stone-600">{claim.label}</span>
              <span className="flex shrink-0 items-baseline gap-2.5">
                <span
                  className={cn(
                    "font-mono text-[16px] leading-6",
                    SENSITIVITY_TEXT[claim.sensitivity],
                  )}
                >
                  {claim.value}
                </span>
                <span
                  className="text-[12px] leading-5 text-stone-400"
                  title={`由 ${claim.issuerName} 簽發`}
                >
                  {claim.issuerSignatureValid ? "簽章 ✓" : "簽章 ✗"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[15px] leading-7 text-stone-400">
          尚未收到任何述詞。需要委託人簽章與本機關的持有證明同時成立。
        </p>
      )}

      {inbox.grantDigest ? (
        <p className="font-mono text-[11px] leading-5 break-all text-stone-400">
          憑匣摘要 {inbox.grantDigest}
        </p>
      ) : null}

      {inbox.lastDenial ? <DenialBanner reason={inbox.lastDenial} /> : null}

      <div className="space-y-3">
        <Button
          size="xl"
          className="w-full"
          disabled={demo.busy || !canRedeem}
          onClick={() => void demo.redeem(grantId, agency)}
          title={!canRedeem ? "需要一張已簽署且未兌現的匣" : undefined}
        >
          兌現本匣
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="w-full"
          disabled={demo.busy || !inbox.receivedAt || Boolean(inbox.submittedAt)}
          onClick={() => void demo.submit(grantId)}
        >
          送出申請
        </Button>
      </div>

      <details className="border-t border-stone-100 pt-5" open={Boolean(inbox.lastDenial)}>
        <summary className="cursor-pointer text-[13px] leading-5 text-stone-400 hover:text-stone-600">
          試著越界
        </summary>
        <div className="mt-4 flex flex-col gap-2">
          <Button
            size="lg"
            variant="ghost"
            className="justify-start text-[14px] text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            disabled={demo.busy}
            onClick={() => void demo.redeem(otherGrant, agency)}
          >
            拿{otherLabel}的匣來兌現
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="justify-start text-[14px] text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            disabled={demo.busy}
            onClick={() => void demo.redeem(grantId, agency)}
          >
            重放已兌現的匣
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="justify-start text-[14px] text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            disabled={demo.busy}
            onClick={() => void demo.requestClaims(agency, overscope.purpose, overscope.claims)}
          >
            {overscope.label}
          </Button>
        </div>
      </details>
    </article>
  );
}

export function AgencyPane({ demo }: { demo: Demo }) {
  const [desk, setDesk] = useState<AgencyId>("jia");
  const current = DESKS.find((item) => item.agency === desk) ?? DESKS[0];

  return (
    <div className="mx-auto w-full max-w-[40rem] space-y-10 px-6 py-10 sm:px-8">
      <PageIntro kicker="機關收件匣" title={demo.view.inboxes[desk].name}>
        要拿到東西，必須自己出示金鑰證明身分，而且該目的要在法定職務範圍內。
      </PageIntro>

      <div className="flex gap-1 rounded-full bg-white/70 p-1 shadow-[0_1px_0_rgba(26,24,20,0.04)]">
        {DESKS.map((item) => {
          const box = demo.view.inboxes[item.agency];
          return (
            <button
              key={item.agency}
              type="button"
              onClick={() => setDesk(item.agency)}
              className={cn(
                "flex-1 rounded-full px-4 py-2.5 text-[14px] leading-5 transition-colors",
                desk === item.agency
                  ? "bg-stone-900 text-white"
                  : "text-stone-500 hover:text-stone-800",
              )}
            >
              {item.short}
              {box.receivedAt ? (
                <span className="ml-1.5 text-[11px] opacity-70">已收件</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <InboxDesk
        demo={demo}
        agency={current.agency}
        grantId={current.grantId}
        overscope={current.overscope}
      />

      <AuditTimeline view={demo.view} />
    </div>
  );
}
