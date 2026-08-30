"use client";

import { StatusChip } from "@/components/status-chip";
import { SURFACE } from "@/components/surface";
import { cn } from "@/lib/utils";
import { formatClock } from "@/lib/view";
import type { PrincipalView } from "@/lib/view";
import type { AuditAction } from "@/lib/types";

const ACTION_LABEL: Record<AuditAction, string> = {
  register: "設定",
  issue: "發證",
  sign: "簽署",
  redeem: "兌現",
  submit: "送件",
  revoke: "撤銷",
  deny: "拒絕",
  notify: "推送",
};

const ACTION_TONE: Record<AuditAction, "stone" | "rose" | "mint" | "amber"> = {
  register: "stone",
  issue: "amber",
  sign: "mint",
  redeem: "mint",
  submit: "mint",
  revoke: "stone",
  deny: "rose",
  notify: "amber",
};

export function AuditTimeline({ view }: { view: PrincipalView }) {
  const untouched = view.vaultCatalog.filter((e) => e.neverLeft && e.sealed);

  return (
    <section className={cn(SURFACE, "space-y-6 p-7 sm:p-9")}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[18px] leading-6 text-stone-800">稽核軌跡</p>
        <StatusChip tone="stone">已用 jti {view.usedJtiCount}</StatusChip>
      </div>

      {untouched.length ? (
        <p className="rounded-2xl bg-emerald-50 px-4 py-3.5 text-[14px] leading-6 text-emerald-900">
          {untouched.map((e) => e.label).join("、")} 從未派生任何憑證，也從未進入任何匣。
        </p>
      ) : null}

      {view.audit.length === 0 ? (
        <p className="text-[15px] leading-7 text-stone-400">還沒有動作。</p>
      ) : (
        <ol className="space-y-5">
          {view.audit
            .slice()
            .reverse()
            .map((entry) => (
              <li key={entry.id} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <StatusChip tone={ACTION_TONE[entry.action]}>
                    {ACTION_LABEL[entry.action]}
                  </StatusChip>
                  <span className="text-[14px] leading-6 text-stone-500">{entry.actor}</span>
                  {entry.grantId ? (
                    <span className="font-mono text-[12px] leading-5 text-stone-400">
                      {entry.grantId}
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0 font-mono text-[12px] leading-5 text-stone-300">
                    {formatClock(entry.at)}
                  </span>
                </div>
                <p className="text-[14px] leading-6 text-stone-500">{entry.detail}</p>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
