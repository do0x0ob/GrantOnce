import type { AuditEntry, DemoState } from "@/lib/types";
import { incomeNeverGranted, incomeSummary } from "@/lib/view";

const ACTION: Record<AuditEntry["action"], { label: string; className: string }> = {
  approve: { label: "核准", className: "bg-emerald-800 text-emerald-50" },
  fetch: { label: "擷取", className: "bg-sky-900 text-sky-50" },
  submit: { label: "送件", className: "bg-stone-800 text-stone-50" },
  revoke: { label: "撤銷", className: "bg-amber-800 text-amber-50" },
  deny: { label: "拒絕", className: "bg-red-800 text-red-50" },
};

export function AuditTimeline({
  entries,
  state,
}: {
  entries: AuditEntry[];
  state: DemoState;
}) {
  const income = incomeSummary(state);
  const heldOut = incomeNeverGranted(state);
  const chronological = [...entries].reverse();

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-stone-800/15 bg-[#fbf8f1] px-3 py-2">
        <p className="text-[11px] tracking-wide text-stone-500">所得</p>
        {income.length > 0 ? (
          <p className="text-[13px] leading-5 text-stone-900">
            {income.map((row) => `${row.label} ${row.value}`).join("　")}
          </p>
        ) : (
          <p className="text-[13px] text-stone-700">金庫有所得紀錄</p>
        )}
        <p className={`text-[13px] font-medium ${heldOut ? "text-emerald-900" : "text-red-800"}`}>
          {heldOut ? "未進入任何授權匣" : "錯誤：所得已被列入匣"}
        </p>
      </div>

      {chronological.length === 0 ? (
        <p className="text-[13px] text-stone-500">尚無核准、擷取、送件、撤銷、拒絕。</p>
      ) : (
        <ol className="divide-y divide-stone-200 border-y border-stone-200">
          {chronological.map((entry) => {
            const meta = ACTION[entry.action];
            return (
              <li key={entry.id} className="grid grid-cols-[3.1rem_2.4rem_2.4rem_1fr] items-baseline gap-2 py-2 text-[13px]">
                <span className="font-mono text-[11px] text-stone-500">{clock(entry.at)}</span>
                <span className={`inline-flex h-5 w-fit items-center rounded px-1 text-[11px] font-medium ${meta.className}`}>
                  {meta.label}
                </span>
                <span className="font-mono text-[12px] text-stone-700">{entry.grantId ?? "—"}</span>
                <span className="leading-5 text-stone-800">{entry.detail}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-TW", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Taipei",
  });
}
