"use client";

import { StatusChip } from "@/components/status-chip";
import { SURFACE } from "@/components/surface";
import { Button } from "@/components/ui/button";
import type { Sensitivity } from "@/lib/claims";
import { AGENCY_NAMES } from "@/lib/parties";
import { PURPOSES } from "@/lib/purposes";
import { cn } from "@/lib/utils";
import { formatDate, type PrincipalView } from "@/lib/view";

const LEVELS: { id: Sensitivity; label: string }[] = [
  { id: "predicate", label: "只給述詞" },
  { id: "pseudonym", label: "可含假名" },
  { id: "personal", label: "可含原始個資" },
];

/**
 * The standing delegation: which agencies, which purposes, how sensitive, until
 * when. Stopping it is the one revocation that always works.
 */
export function DelegationCard({
  delegation,
  busy,
  onStop,
  onRestore,
  onSetMax,
}: {
  delegation: PrincipalView["delegation"];
  busy: boolean;
  onStop: () => void;
  onRestore: () => void;
  onSetMax: (level: Sensitivity) => void;
}) {
  return (
    <details className={cn(SURFACE, "group p-6")} open={!delegation.active}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <p className="text-[15px] leading-6 text-stone-700">我的委託設定</p>
        <StatusChip tone={delegation.active ? "mint" : "rose"}>
          {delegation.active ? "生效中" : "已停止"}
        </StatusChip>
      </summary>

      <div className="mt-6 space-y-6">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[14px] leading-6">
          <dt className="text-stone-400">機關</dt>
          <dd className="text-stone-600">
            {delegation.agencies.map((a) => AGENCY_NAMES[a]).join("、") || "無"}
          </dd>
          <dt className="text-stone-400">目的</dt>
          <dd className="text-stone-600">
            {delegation.purposes.map((p) => PURPOSES[p].title).join("、") || "無"}
          </dd>
          <dt className="text-stone-400">單匣效期</dt>
          <dd className="text-stone-600">{delegation.grantTtlSeconds} 秒，一次性</dd>
          <dt className="text-stone-400">委託到期</dt>
          <dd className="text-stone-600">{formatDate(delegation.validUntil)}</dd>
        </dl>

        <div className="space-y-2">
          <p className="text-[13px] leading-5 text-stone-400">最高可授權等級</p>
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((level) => (
              <button
                key={level.id}
                type="button"
                disabled={busy || !delegation.active}
                onClick={() => onSetMax(level.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[13px] leading-5 disabled:opacity-40",
                  delegation.maxSensitivity === level.id
                    ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--primary-foreground)]"
                    : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50",
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
            onClick={onStop}
          >
            停止委託
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="text-[14px] leading-6 text-stone-500">
              {delegation.revokedReason}　尚未兌現的匣已全部作廢。已交付給機關的述詞收不回來——
              這是這個設計誠實的邊界，也是為什麼一開始就只給述詞。
            </p>
            <Button size="lg" disabled={busy} onClick={onRestore}>
              重新啟用委託
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
