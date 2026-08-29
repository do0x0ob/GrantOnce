import { StatusChip } from "@/components/denial-banner";
import type { AuditEntry, DemoState } from "@/lib/types";
import { incomeNeverGranted, incomeSummary } from "@/lib/view";

const ACTION: Record<AuditEntry["action"], string> = {
  approve: "核准",
  fetch: "擷取",
  submit: "送件",
  revoke: "撤銷",
  deny: "拒絕",
  receipt: "收據",
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
    <div className="space-y-4">
      <div>
        <p className="text-[12px] leading-5 text-stone-400">所得</p>
        {income.length > 0 ? (
          <p className="text-[13px] leading-6 text-stone-800">
            {income.map((row) => `${row.label} ${row.value}`).join("　")}
          </p>
        ) : (
          <p className="text-[13px] leading-6 text-stone-600">金庫有所得紀錄</p>
        )}
        <p className={`text-[13px] leading-5 ${heldOut ? "text-stone-400" : "text-rose-600"}`}>
          {heldOut ? "未進入任何授權匣" : "錯誤：所得已被列入匣"}
        </p>
      </div>

      {chronological.length === 0 ? (
        <p className="text-[13px] leading-6 text-stone-400">尚無紀錄。</p>
      ) : (
        <ol className="relative space-y-3 border-l border-stone-200/80 pl-4">
          {chronological.map((entry) => (
            <li key={entry.id} className="relative text-[13px] leading-6">
              <span className="absolute top-2 -left-[21px] size-1.5 rounded-full bg-stone-300" />
              <p className="flex flex-wrap items-baseline gap-x-2 text-stone-800">
                {entry.action === "deny" ? (
                  <StatusChip tone="rose">403</StatusChip>
                ) : (
                  <span className="text-stone-400">{ACTION[entry.action]}</span>
                )}
                {entry.grantId ? <span className="text-stone-400">{entry.grantId}</span> : null}
                <span className="font-mono text-[11px] text-stone-300">{clock(entry.at)}</span>
              </p>
              <p className="text-stone-600">{entry.detail}</p>
            </li>
          ))}
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
