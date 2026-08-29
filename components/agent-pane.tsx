import { Badge } from "@/components/ui/badge";
import { FIELD_META } from "@/lib/fields";
import type { DemoState, FieldId } from "@/lib/types";
import { agentSight } from "@/lib/view";

export function AgentPane({ state }: { state: DemoState }) {
  const sight = agentSight(state);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="shrink-0 border-b border-stone-300/70 pb-2">
        <p className="text-[11px] text-stone-500">代理人</p>
        <h2 className="font-serif text-xl leading-7 text-stone-900">補助申請代理人</h2>
        <p className="text-[13px] leading-5 text-stone-600">規則引擎比資格。匣才是讀金庫的憑證。</p>
      </header>

      <section className="rounded-lg border border-stone-300/80 bg-white/80 p-3">
        <h3 className="mb-2 text-[13px] font-medium">計畫</h3>
        {!state.plan ? (
          <p className="text-[13px] text-stone-500">等待需求。偵測搬家後列出兩個最小欄位匣。</p>
        ) : (
          <div className="space-y-3">
            {state.plan.programs.map((program) => (
              <div key={program.grantId} className="border-b border-stone-100 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="rounded-md font-mono">
                    {program.grantId}
                  </Badge>
                  <p className="text-[13px] font-medium">{program.title}</p>
                </div>
                <p className="mt-1 text-[12px] text-stone-500">{program.agencyName}</p>
                <ul className="mt-1 list-disc pl-4 text-[13px] leading-5 text-stone-700">
                  {program.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[13px] leading-5 text-amber-950">
              {state.plan.ageHint}
            </p>
          </div>
        )}
      </section>

      <section className="min-h-0 flex-1 space-y-2 overflow-auto rounded-lg border border-stone-300/80 bg-[#fbf8f1] p-3">
        <h3 className="text-[13px] font-medium">現在看得見／看不見</h3>
        <SightBlock
          title="現在可讀"
          empty="還沒有有效匣。"
          ids={sight.readableNow}
          tone="ok"
        />
        <SightBlock
          title="已耗用，不能再讀"
          empty="尚無耗用的匣。"
          ids={sight.consumed}
          tone="spent"
        />
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-[13px] font-medium text-red-900">金庫有、未授權</p>
          <p className="mt-1 text-[13px] leading-5 text-red-800">
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
  tone,
}: {
  title: string;
  empty: string;
  ids: FieldId[];
  tone: "ok" | "spent";
}) {
  return (
    <div>
      <p className="text-[12px] font-medium text-stone-700">{title}</p>
      {ids.length === 0 ? (
        <p className="text-[12px] text-stone-500">{empty}</p>
      ) : (
        <div className="mt-1 flex flex-wrap gap-1">
          {ids.map((id) => (
            <Badge
              key={id}
              variant="outline"
              className={
                tone === "ok"
                  ? "rounded-md border-emerald-800/30 bg-emerald-50"
                  : "rounded-md border-stone-300 bg-stone-100"
              }
            >
              {FIELD_META[id].label}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
