"use client";

import { useState } from "react";
import { AuditTimeline } from "@/components/audit-timeline";
import { DenialBanner } from "@/components/denial-banner";
import { PageFrame, PageSplit } from "@/components/page-frame";
import { PageIntro } from "@/components/page-intro";
import { StatusChip } from "@/components/status-chip";
import { GRANT_WASH, SURFACE } from "@/components/surface";
import { SENSITIVITY_TEXT } from "@/components/tone";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Demo } from "@/hooks/use-demo";
import { PURPOSE_IDS, PURPOSES, type PurposeId } from "@/lib/purposes";
import type { ApplicationStatus, GrantId } from "@/lib/types";

/** Demo fixture: nothing past 「已送件」 comes from a real agency. */
const STATUS_LABEL: Record<ApplicationStatus, string> = {
  none: "尚未開始",
  received: "已收件",
  submitted: "已送件",
  "under-review": "審核中",
  "needs-more": "要求補件",
  approved: "已核定",
  paid: "已撥款",
};

const ADVANCEABLE: ApplicationStatus[] = ["under-review", "needs-more", "approved", "paid"];

/**
 * The overscope button per desk. Both entries are raw fields outside every
 * purpose's ceiling, so the refusal is about scope rather than about the field
 * happening to be missing from this one purpose.
 */
const OVERSCOPE: Record<string, { claims: string[]; label: string }> = {
  jia: { claims: ["raw.income.annual", "raw.household.address"], label: "索取所得與地址" },
  yi: { claims: ["raw.household.householdId"], label: "索取戶號" },
};

/** Short desk label: the purpose's own title, trimmed to fit a tab. */
function tabLabel(purposeId: PurposeId): string {
  return PURPOSES[purposeId].title.replace(/^未滿 5 歲幼兒/, "");
}

/**
 * A purpose at a different agency, so presenting its capsule here is a genuine
 * audience mismatch rather than a merely unsigned capsule. Derived, because with
 * two purposes at 甲 the old 「甲 or 乙」 ternary could pick a sibling.
 */
function otherAgencyPurpose(purposeId: PurposeId): PurposeId {
  const mine = PURPOSES[purposeId].agency;
  return PURPOSE_IDS.find((id) => PURPOSES[id].agency !== mine) ?? purposeId;
}

function InboxDesk({ demo, purposeId }: { demo: Demo; purposeId: PurposeId }) {
  const purpose = PURPOSES[purposeId];
  const agency = purpose.agency;
  const inbox = demo.view.inboxes[purposeId];
  // Follow this purpose's own capsule. Matching on the agency instead left the
  // desk wired to 育兒津貼 after the child aged out of it and 托育補助 took its
  // place — the two share an agency, so only the purpose tells them apart.
  const grant =
    demo.view.grants.find((g) => g.purpose === purposeId && g.status !== "revoked") ??
    demo.view.grants.find((g) => g.purpose === purposeId);
  const grantId = (grant?.id ?? purpose.slot) as GrantId;

  const otherId = otherAgencyPurpose(purposeId);
  const other = demo.view.grants.find((g) => g.purpose === otherId);
  const otherGrant = (other?.id ?? PURPOSES[otherId].slot) as GrantId;
  const otherLabel = PURPOSES[otherId].agencyName;
  const canRedeem = grant?.status === "signed";
  const overscope = OVERSCOPE[agency];

  return (
    <article className={cn(SURFACE, GRANT_WASH[agency], "space-y-8 p-7 sm:p-9")}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <h2 className="text-[22px] font-medium leading-7 tracking-tight text-stone-900">
            {inbox.programTitle}
          </h2>
          <p className="text-[14px] leading-5 text-stone-400">
            {inbox.slot} · {inbox.name}
          </p>
        </div>
        {inbox.submittedAt ? (
          <StatusChip tone="mint">已送件</StatusChip>
        ) : inbox.receivedAt ? (
          <StatusChip tone="mint">已收件</StatusChip>
        ) : (
          <StatusChip tone="stone">等待授權</StatusChip>
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
          尚未收到任何資格證明。使用者簽署後，本機關還要出示持有證明，資料來源機關才會直接交付。
        </p>
      )}

      {inbox.lastDenial ? <DenialBanner reason={inbox.lastDenial} /> : null}

      {canRedeem ? (
        <Button
          size="xl"
          className="w-full"
          disabled={demo.busy}
          onClick={() => void demo.redeem(grantId, agency)}
        >
          持 Grant 向資料來源機關取證
        </Button>
      ) : null}
      {inbox.receivedAt && !inbox.submittedAt ? (
        <Button
          size="xl"
          className="w-full"
          disabled={demo.busy}
          onClick={() => void demo.submit(grantId)}
        >
          使用收到的證明開始處理
        </Button>
      ) : null}
      {inbox.grantDigest ? (
        <p className="font-mono text-[11px] leading-5 break-all text-stone-400">
          憑匣摘要 {inbox.grantDigest}
        </p>
      ) : null}

      <div className="space-y-3 border-t border-stone-100 pt-5">
        <p className="text-[13px] leading-5 text-stone-400">
          申辦進度：{STATUS_LABEL[inbox.applicationStatus]}
          <span className="ml-1">（演示用，未連真實機關）</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ADVANCEABLE.map((status) => (
            <Button
              key={status}
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-2.5 text-[12px] text-stone-400 hover:text-stone-700"
              disabled={demo.busy || !inbox.submittedAt}
              onClick={() => void demo.advanceApplication(purposeId, status)}
              title={inbox.submittedAt ? undefined : "要先送件"}
            >
              {STATUS_LABEL[status]}
            </Button>
          ))}
        </div>
      </div>

      <details className="border-t border-stone-100 pt-5" open={Boolean(inbox.lastDenial)}>
        <summary className="cursor-pointer text-[13px] leading-5 text-stone-400 hover:text-stone-600">
          試著越界
        </summary>
        <div className="mt-4 flex flex-col gap-2">
          <Button
            size="lg"
            variant="ghost"
            className="justify-start text-[14px] text-[var(--orchid-deep)] hover:bg-[var(--wash-risk)] hover:text-[var(--orchid-deep)]"
            disabled={demo.busy}
            onClick={() => void demo.redeem(otherGrant, agency)}
          >
            拿「{otherLabel}」的匣來兌現
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="justify-start text-[14px] text-[var(--orchid-deep)] hover:bg-[var(--wash-risk)] hover:text-[var(--orchid-deep)]"
            disabled={demo.busy}
            onClick={() => void demo.redeem(grantId, agency)}
          >
            重放已兌現的匣
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="justify-start text-[14px] text-[var(--orchid-deep)] hover:bg-[var(--wash-risk)] hover:text-[var(--orchid-deep)]"
            disabled={demo.busy}
            onClick={() => void demo.requestClaims(agency, purposeId, overscope.claims)}
          >
            {overscope.label}
          </Button>
        </div>
      </details>
    </article>
  );
}

export function AgencyPane({ demo }: { demo: Demo }) {
  // One desk per purpose, straight off the registry — a new subsidy shows up
  // here without an edit.
  const [desk, setDesk] = useState<PurposeId>(PURPOSE_IDS[0]);
  const current = (PURPOSE_IDS as readonly string[]).includes(desk) ? desk : PURPOSE_IDS[0];

  return (
    <PageFrame className="space-y-10">
      <PageIntro kicker="請求機關工作台" title={demo.view.inboxes[current].name}>
        請求機關持使用者簽署的 Grant 向資料來源機關取證。資料直接進本服務收件匣，不提供給語言模型。
      </PageIntro>

      <PageSplit>
        <div className="space-y-6">
          <div className="flex gap-1 rounded-full bg-white/70 p-1 shadow-[0_1px_0_rgba(26,24,20,0.04)]">
            {PURPOSE_IDS.map((id) => {
              const box = demo.view.inboxes[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDesk(id)}
                  className={cn(
                    "flex-1 rounded-full px-3 py-2.5 text-[13px] leading-5 transition-colors",
                    current === id
                      ? "bg-[var(--ink)] text-[var(--primary-foreground)]"
                      : "text-stone-500 hover:text-stone-800",
                  )}
                >
                  {tabLabel(id)}
                  {box.receivedAt ? (
                    <span className="ml-1.5 text-[11px] opacity-70">已收件</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <InboxDesk demo={demo} purposeId={current} />
        </div>
        <AuditTimeline view={demo.view} />
      </PageSplit>
    </PageFrame>
  );
}
