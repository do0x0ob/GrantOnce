"use client";

import { useState } from "react";
import { StatusChip } from "@/components/status-chip";
import { Button } from "@/components/ui/button";
import type { Demo } from "@/hooks/use-demo";
import type { Sensitivity } from "@/lib/claims";
import { AGENCY_NAMES } from "@/lib/parties";
import { PURPOSES } from "@/lib/purposes";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/view";

const LEVELS: { id: Sensitivity; label: string }[] = [
  { id: "predicate", label: "只給述詞" },
  { id: "pseudonym", label: "可含假名" },
  { id: "personal", label: "可含原始個資" },
];

const HEADER_LINK =
  "inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13px] leading-5 text-stone-500 transition-colors hover:bg-white/60 hover:text-stone-800 focus-visible:ring-2 focus-visible:ring-stone-400";

/**
 * The standing delegation, opened from the header next to 文件.
 */
export function DelegationMenu({ demo }: { demo: Demo }) {
  const [open, setOpen] = useState(false);
  const { view, busy } = demo;
  const delegation = view.delegation;
  const purposeTitles = Object.fromEntries(view.registry.purposes.map((row) => [row.id, row.title]));

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={cn(HEADER_LINK, open && "bg-white/60 text-stone-800")}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            delegation.active ? "bg-[var(--sage)]" : "bg-[var(--orchid)]",
          )}
        />
        委託設定
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-40 w-[20.5rem] pt-2">
          <div
            role="dialog"
            aria-label="我的委託設定"
            className="rounded-[24px] bg-[var(--popover)] p-5 shadow-[0_1px_0_rgba(60,56,53,0.04),0_20px_40px_-24px_rgba(60,56,53,0.28)]"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-[15px] leading-6 text-stone-700">我的委託設定</p>
              <StatusChip tone={delegation.active ? "mint" : "rose"}>
                {delegation.active ? "生效中" : "已停止"}
              </StatusChip>
            </div>

            <div className="space-y-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px] leading-5">
                <dt className="text-stone-400">機關</dt>
                <dd className="text-stone-600">
                  {delegation.agencies.map((a) => AGENCY_NAMES[a]).join("、") || "無"}
                </dd>
                <dt className="text-stone-400">目的</dt>
                <dd className="text-stone-600">
                  {delegation.purposes.map((p) => purposeTitles[p] ?? PURPOSES[p]?.title ?? p).join("、") || "無"}
                </dd>
                <dt className="text-stone-400">單匣效期</dt>
                <dd className="text-stone-600">{delegation.grantTtlSeconds} 秒，一次性</dd>
                <dt className="text-stone-400">委託到期</dt>
                <dd className="text-stone-600">{formatDate(delegation.validUntil)}</dd>
              </dl>

              <div className="space-y-2">
                <p className="text-[12px] leading-4 text-stone-400">最高可授權等級</p>
                <div className="flex flex-wrap gap-1.5">
                  {LEVELS.map((level) => (
                    <button
                      key={level.id}
                      type="button"
                      disabled={busy || !delegation.active}
                      onClick={() => void demo.setMaxSensitivity(level.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[12px] leading-5 disabled:opacity-40",
                        delegation.maxSensitivity === level.id
                          ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--primary-foreground)]"
                          : "border-stone-200/80 bg-white/70 text-stone-600 hover:bg-white",
                      )}
                    >
                      {level.label}
                    </button>
                  ))}
                </div>
              </div>

              {delegation.active ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full text-[var(--orchid-deep)] hover:bg-[var(--wash-risk)] hover:text-[var(--orchid-deep)]"
                  disabled={busy}
                  onClick={() => void demo.stopDelegation()}
                >
                  停止委託
                </Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-[13px] leading-5 text-stone-500">
                    {delegation.revokedReason}　尚未兌現的匣已全部作廢。已交付給機關的述詞收不回來。
                  </p>
                  <Button size="lg" disabled={busy} onClick={() => void demo.restoreDelegation()}>
                    重新啟用委託
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
