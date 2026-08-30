import { CardHead } from "@/components/agent/card-head";
import { SURFACE } from "@/components/surface";
import { cn } from "@/lib/utils";
import { formatClock } from "@/lib/view";
import type { PrincipalView } from "@/lib/view";

const LABEL: Record<string, string> = {
  register: "設定",
  issue: "發證",
  sign: "簽署",
  redeem: "兌現",
  submit: "送件",
  revoke: "撤銷",
  deny: "拒絕",
  notify: "推送",
};

/** Who took what, when, and on which capsule. */
export function AuditCard({ view }: { view: PrincipalView }) {
  const entries = [...view.audit].reverse().slice(0, 12);

  return (
    <section className={cn(SURFACE, "space-y-4 px-6 py-5")}>
      <CardHead title="誰拿過我的資料" sub={`${view.audit.length} 筆 · 不含金庫值`} />

      {entries.length === 0 ? (
        <p className="text-[13px] leading-6 text-stone-500">還沒有任何動作。</p>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[12px] leading-5">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5",
                    entry.action === "deny"
                      ? "bg-[var(--wash-risk)] text-rose-700"
                      : "bg-stone-900/5 text-stone-600",
                  )}
                >
                  {LABEL[entry.action] ?? entry.action}
                </span>
                <span className="text-stone-500">{entry.actor}</span>
                <span className="ml-auto font-mono text-[11px] text-stone-400">
                  {formatClock(entry.at)}
                </span>
              </div>
              <p className="text-[13px] leading-6 text-stone-600">{entry.detail}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
