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
        className="w-full rounded-full border border-dashed border-stone-200 px-3 py-1.5 text-[12px] leading-5 text-stone-400 hover:bg-white disabled:opacity-40"
      >
        讓代理人主動檢查我的資格有沒有變
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[12px] leading-4 text-stone-400">代理人主動提醒</p>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 rounded-full px-2 text-[11px] text-stone-400 hover:text-stone-600"
          disabled={busy}
          onClick={onScan}
        >
          再檢查
        </Button>
      </div>
      {notifications.map((n) => (
        <article key={n.id} className={cn(SURFACE, "space-y-1.5 p-3")}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] leading-5 text-stone-700">{n.title}</p>
            <StatusChip tone={TONE[n.kind] ?? "stone"}>
              {n.kind === "risk" ? "攔截" : n.kind === "credential-expiry" ? "憑證" : "資格"}
            </StatusChip>
          </div>
          <p className="whitespace-pre-wrap text-[12px] leading-5 text-stone-500">{n.body}</p>
        </article>
      ))}
    </div>
  );
}
