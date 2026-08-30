"use client";

import { StatusChip, type ChipTone } from "@/components/status-chip";
import { SURFACE, WASH } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NotificationKind } from "@/lib/types";
import type { PrincipalView } from "@/lib/view";

const TONE: Record<NotificationKind, ChipTone> = {
  // The one piece of good news the watch loop can deliver reads as good news.
  "eligibility-gained": "mint",
  "eligibility-change": "amber",
  "credential-expiry": "amber",
  "credential-expiring": "stone",
  "grant-expiring": "amber",
  "delegation-expiring": "amber",
  "denial-followup": "rose",
  "awaiting-signature": "amber",
  risk: "rose",
  info: "stone",
};

const CHIP: Record<NotificationKind, string> = {
  "eligibility-gained": "新資格",
  "eligibility-change": "資格",
  "credential-expiry": "憑證",
  "credential-expiring": "憑證",
  "grant-expiring": "效期",
  "delegation-expiring": "委託",
  "denial-followup": "攔截",
  "awaiting-signature": "待簽",
  risk: "攔截",
  info: "訊息",
};

/** The proactive half: the agent pushes, the principal does not have to ask. */
export function NotificationList({
  notifications,
  busy,
  onScan,
  onAcknowledge,
}: {
  notifications: PrincipalView["notifications"];
  busy: boolean;
  onScan: () => void;
  onAcknowledge: (id: string) => void;
}) {
  if (!notifications.length) return null;

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
            n.severity === "risk" && WASH.risk,
            n.kind === "eligibility-gained" && WASH.ok,
            n.acknowledged && "opacity-60",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-[16px] leading-6 text-stone-800">{n.title}</p>
            <StatusChip tone={n.acknowledged ? "stone" : TONE[n.kind]}>
              {n.acknowledged ? "已簽收" : CHIP[n.kind]}
            </StatusChip>
          </div>
          <p className="whitespace-pre-wrap text-[14px] leading-6 text-stone-500">{n.body}</p>
          {n.suggestedAction ? (
            <p className="text-[13px] leading-5 text-[var(--ink-soft)]">
              建議的下一步：{n.suggestedAction.label}
              <span className="ml-1 font-mono text-[12px]">（{n.suggestedAction.tool}）</span>
            </p>
          ) : null}
          {n.acknowledged ? null : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-2 text-[12px] text-stone-400 hover:text-stone-700"
              disabled={busy}
              onClick={() => onAcknowledge(n.id)}
            >
              簽收
            </Button>
          )}
        </article>
      ))}
    </div>
  );
}
