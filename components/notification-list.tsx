"use client";

import { StatusChip } from "@/components/status-chip";
import { SURFACE } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PrincipalView } from "@/lib/view";

const TONE: Record<string, "amber" | "rose" | "mint" | "stone"> = {
  "eligibility-change": "amber",
  "credential-expiry": "amber",
  risk: "rose",
  info: "stone",
};

/** The proactive half: the agent pushes, the principal does not have to ask. */
export function NotificationList({
  notifications,
  busy,
  onScan,
}: {
  notifications: PrincipalView["notifications"];
  busy: boolean;
  onScan: () => void;
}) {
  if (!notifications.length) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onScan}
        className="text-[13px] leading-5 text-stone-400 underline-offset-4 hover:text-stone-600 hover:underline disabled:opacity-40"
      >
        讓代理人主動檢查我的資格有沒有變
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] leading-5 tracking-[0.04em] text-stone-400">代理人主動提醒</p>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 rounded-full px-2 text-[12px] text-stone-400 hover:text-stone-700"
          disabled={busy}
          onClick={onScan}
        >
          再檢查
        </Button>
      </div>
      {notifications.map((n) => (
        <article
          key={n.id}
          className={cn(
            SURFACE,
            "space-y-2 p-5",
            n.kind === "risk" && "ring-1 ring-rose-100",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-[16px] leading-6 text-stone-800">{n.title}</p>
            <StatusChip tone={TONE[n.kind] ?? "stone"}>
              {n.kind === "risk" ? "攔截" : n.kind === "credential-expiry" ? "憑證" : "資格"}
            </StatusChip>
          </div>
          <p className="whitespace-pre-wrap text-[14px] leading-6 text-stone-500">{n.body}</p>
        </article>
      ))}
    </div>
  );
}
