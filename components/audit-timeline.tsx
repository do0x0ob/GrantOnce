import type { AuditEntry, DemoState } from "@/lib/types";
import { incomeNeverGranted, incomeSummary } from "@/lib/view";

const ACTION: Record<AuditEntry["action"], string> = {
  approve: "核准",
  fetch: "擷取",
  submit: "送件",
  revoke: "撤銷",
  deny: "拒絕",
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
      <div className="rounded-[16px] bg-[#F5F5F5] px-3 py-2.5">
        <p className="text-[12px] text-neutral-500">所得</p>
        {income.length > 0 ? (
          <p className="text-[13px] leading-5 text-neutral-900">
            {income.map((row) => `${row.label} ${row.value}`).join("　")}
          </p>
        ) : (
          <p className="text-[13px] text-neutral-700">金庫有所得紀錄</p>
        )}
        <p className={`text-[13px] font-medium ${heldOut ? "text-emerald-700" : "text-rose-700"}`}>
          {heldOut ? "未進入任何授權匣" : "錯誤：所得已被列入匣"}
        </p>
      </div>

      {chronological.length === 0 ? (
        <p className="text-[13px] text-neutral-400">尚無核准、擷取、送件、撤銷、拒絕。</p>
      ) : (
        <ol className="space-y-2">
          {chronological.map((entry) => (
            <li key={entry.id} className="grid grid-cols-[3.2rem_2.4rem_2.2rem_1fr] items-baseline gap-2 text-[13px]">
              <span className="font-mono text-[11px] text-neutral-400">{clock(entry.at)}</span>
              <span className={entry.action === "deny" ? "font-medium text-rose-700" : "text-neutral-700"}>
                {ACTION[entry.action]}
              </span>
              <span className="text-[12px] text-neutral-500">{entry.grantId ?? "—"}</span>
              <span className="leading-5 text-neutral-800">{entry.detail}</span>
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
