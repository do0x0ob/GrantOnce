import { IdentityDot } from "@/components/identity-dot";
import { FIELD_META } from "@/lib/fields";
import type { DemoState, FieldId } from "@/lib/types";
import { agentSight } from "@/lib/view";

export function AgentPane({ state }: { state: DemoState }) {
  const sight = agentSight(state);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="mb-4 flex items-center gap-2.5">
        <IdentityDot tone="agent" className="size-3" />
        <div>
          <h2 className="text-[15px] font-medium tracking-tight text-neutral-900">補助申請代理人</h2>
          <p className="text-[12px] text-neutral-500">規則引擎比資格 · 匣才是憑證</p>
        </div>
      </header>

      <section className="mb-3 rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h3 className="mb-2 text-[12px] text-neutral-500">計畫</h3>
        {!state.plan ? (
          <p className="text-[13px] leading-5 text-neutral-500">等待需求。偵測搬家後列出兩個最小欄位匣。</p>
        ) : (
          <div className="space-y-3">
            {state.plan.programs.map((program) => (
              <div key={program.grantId}>
                <div className="flex items-center gap-2">
                  <IdentityDot tone={program.agencyId === "jia" ? "jia" : "yi"} />
                  <p className="text-[13px] font-medium text-neutral-900">{program.title}</p>
                  <span className="text-[12px] text-neutral-400">{program.grantId}</span>
                </div>
                <p className="mt-0.5 pl-4 text-[12px] text-neutral-500">{program.agencyName}</p>
                <ul className="mt-1 space-y-0.5 pl-4 text-[13px] leading-5 text-neutral-700">
                  {program.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="rounded-2xl bg-amber-50 px-3 py-2 text-[13px] leading-5 text-amber-900">
              {state.plan.ageHint}
            </p>
          </div>
        )}
      </section>

      <section className="min-h-0 flex-1 space-y-3 overflow-auto rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h3 className="text-[12px] text-neutral-500">現在看得見／看不見</h3>
        <SightBlock title="現在可讀" empty="還沒有有效匣。" ids={sight.readableNow} />
        <SightBlock title="已耗用，不能再讀" empty="尚無耗用的匣。" ids={sight.consumed} />
        <div className="rounded-2xl bg-rose-50 px-3 py-2.5">
          <p className="text-[13px] font-medium text-rose-800">金庫有、未授權</p>
          <p className="mt-1 text-[13px] leading-5 text-rose-700">
            {sight.incomeHeldBack.length > 0
              ? `所得：${sight.incomeHeldBack.map((id) => FIELD_META[id].label).join("、")}。未進入任何匣。`
              : "所得已被授權（本演示不該發生）。"}
          </p>
        </div>
      </section>
    </div>
  );
}

function SightBlock({
  title,
  empty,
  ids,
}: {
  title: string;
  empty: string;
  ids: FieldId[];
}) {
  return (
    <div>
      <p className="text-[12px] text-neutral-500">{title}</p>
      {ids.length === 0 ? (
        <p className="text-[13px] text-neutral-400">{empty}</p>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <span
              key={id}
              className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[12px] text-neutral-700"
            >
              {FIELD_META[id].label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
