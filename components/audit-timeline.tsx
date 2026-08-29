import { ScrollArea } from "@/components/ui/scroll-area";
import type { AuditEntry } from "@/lib/types";
import { formatClock } from "@/lib/view";

const ACTION: Record<AuditEntry["action"], { label: string; className: string }> = {
  approve: { label: "核准", className: "bg-emerald-800 text-emerald-50" },
  fetch: { label: "擷取", className: "bg-sky-900 text-sky-50" },
  submit: { label: "送件", className: "bg-stone-800 text-stone-50" },
  revoke: { label: "撤銷", className: "bg-amber-800 text-amber-50" },
  deny: { label: "拒絕", className: "bg-red-800 text-red-50" },
};

export function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-stone-500">
        還沒有稽核紀錄。核准、擷取、送件、撤銷、拒絕都會出現在這裡。
      </p>
    );
  }

  const chronological = [...entries].reverse();

  return (
    <ScrollArea className="h-[280px] pr-3">
      <ol className="relative space-y-3 border-l border-stone-300 pl-4">
        {chronological.map((entry) => {
          const meta = ACTION[entry.action];
          return (
            <li key={entry.id} className="relative">
              <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-stone-400" />
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}>
                  {meta.label}
                </span>
                {entry.grantId ? (
                  <span className="font-mono text-[11px] text-stone-600">{entry.grantId}</span>
                ) : null}
                <span className="text-[11px] text-stone-500">{formatClock(entry.at)}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-stone-700">
                {entry.actor} · {entry.detail}
              </p>
            </li>
          );
        })}
      </ol>
    </ScrollArea>
  );
}
