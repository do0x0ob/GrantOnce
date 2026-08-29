import { Badge } from "@/components/ui/badge";
import { FIELD_META } from "@/lib/fields";
import type { DemoState, FieldId } from "@/lib/types";
import { agentSight } from "@/lib/view";

export function AgentPane({ state }: { state: DemoState }) {
  const sight = agentSight(state);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header>
        <p className="text-[11px] tracking-[0.2em] text-stone-500">代理人</p>
        <h2 className="font-serif text-xl text-stone-900">補助申請代理人</h2>
        <p className="text-xs leading-5 text-stone-600">
          資格用規則引擎。授權匣是唯一能讀金庫的憑證。
        </p>
      </header>

      <section className="rounded-xl border border-stone-300/80 bg-white/80 p-3">
        <h3 className="mb-2 text-sm font-medium">計畫</h3>
        {!state.plan ? (
          <p className="text-sm text-stone-500">
            等待委託人描述需求。偵測到搬家後，會列出兩個最小欄位申請案。
          </p>
        ) : (
          <div className="space-y-3">
            {state.plan.programs.map((program) => (
              <div key={program.grantId} className="border-b border-stone-100 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="rounded-md font-mono">
                    {program.grantId}
                  </Badge>
                  <p className="text-sm font-medium">{program.title}</p>
                </div>
                <p className="mt-1 text-xs text-stone-500">{program.agencyName}</p>
                <ul className="mt-1 list-disc pl-4 text-xs leading-5 text-stone-700">
                  {program.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs leading-5 text-amber-950">
              {state.plan.ageHint}
            </p>
            <ul className="space-y-1 text-[11px] text-stone-500">
              {state.plan.notes.map((note) => (
                <li key={note}>· {note}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="min-h-0 flex-1 space-y-2 overflow-auto rounded-xl border border-stone-300/80 bg-[#fbf7ee] p-3">
        <h3 className="text-sm font-medium">現在看得見／看不見</h3>

        <SightBlock
          title="現在可讀（有效匣）"
          empty="還沒有有效匣。核准後才會從假 MyData 擷取。"
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
          <p className="text-xs font-medium text-red-900">金庫有、未授權</p>
          <p className="mt-1 text-xs leading-5 text-red-800">
            {sight.incomeHeldBack.length > 0
              ? `所得：${sight.incomeHeldBack.map((id) => FIELD_META[id].label).join("、")}。這證明資料可以存在，但不被給出。`
              : "所得已被授權（本演示不該發生）。"}
          </p>
          <p className="mt-1 text-[11px] text-red-700">
            其他未授權：
            {sight.neverGranted
              .filter((id) => !sight.incomeHeldBack.includes(id))
              .map((id) => FIELD_META[id].label)
              .join("、") || "無"}
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
      <p className="text-xs font-medium text-stone-700">{title}</p>
      {ids.length === 0 ? (
        <p className="text-[11px] text-stone-500">{empty}</p>
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
