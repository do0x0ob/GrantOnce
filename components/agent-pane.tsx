import { StatusChip } from "@/components/denial-banner";
import { IdentityDot } from "@/components/identity-dot";
import { SURFACE } from "@/components/surface";
import { FIELD_META } from "@/lib/fields";
import type { DemoState, FieldId } from "@/lib/types";
import { agentSight, groupedFields, incomeNeverGranted } from "@/lib/view";
import { Lock } from "lucide-react";

const GROUP_ORDER = ["所得", "戶籍", "親子關係", "台電", "健保"];

export function AgentPane({ state }: { state: DemoState }) {
  const sight = agentSight(state);
  const holdings = state.vaultHoldings ?? [];
  const groups = [...groupedFields(holdings.map((h) => h.fieldId))].sort(
    ([a], [b]) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b),
  );
  const heldOut = incomeNeverGranted(state);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center gap-2">
        <IdentityDot tone="agent" />
        <p className="text-[14px] leading-5 text-stone-700">代理人</p>
      </div>

      <section className={`${SURFACE} flex min-h-0 flex-1 flex-col px-5 py-4`}>
        <div className="mb-3 flex items-center gap-1.5">
          <Lock className="size-3 text-stone-400" strokeWidth={1.75} aria-hidden />
          <p className="text-[13px] leading-5 text-stone-400">假 MyData 金庫</p>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
          {groups.map(([group, ids]) => {
            const rows = ids
              .map((id) => holdings.find((h) => h.fieldId === id))
              .filter((row): row is NonNullable<typeof row> => Boolean(row));
            const sealed = rows.some((row) => row.sealed);
            return (
              <div key={group}>
                <div className="mb-1 flex items-center gap-2">
                  <p className="text-[14px] leading-5 text-stone-800">{group}</p>
                  {sealed ? (
                    <StatusChip tone="rose">在金庫 · 未入匣</StatusChip>
                  ) : (
                    <StatusChip>可分匣</StatusChip>
                  )}
                </div>
                <dl className="space-y-0.5">
                  {rows.map((row) => (
                    <div
                      key={row.fieldId}
                      className="grid grid-cols-[6.2rem_1fr] gap-2 text-[13px] leading-6"
                    >
                      <dt className="text-stone-400">{row.label}</dt>
                      <dd className="text-stone-800">
                        {row.value}
                        {sealed ? (
                          <Lock
                            className="ml-1 inline size-3 align-[-2px] text-stone-300"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
                {sealed ? (
                  <p className="mt-1 text-[13px] leading-5 text-stone-400">
                    {heldOut ? "未進入任何授權匣" : "錯誤：所得已被列入匣"}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="mt-4 border-t border-stone-100 pt-3">
          <p className="text-[12px] leading-5 text-stone-400">現在可讀</p>
          <Sight ids={sight.readableNow} empty="還沒有有效匣。" />
          {sight.consumed.length > 0 ? (
            <>
              <p className="mt-2 text-[12px] leading-5 text-stone-400">已耗用</p>
              <Sight ids={sight.consumed} empty="" />
            </>
          ) : null}
          {state.plan?.ageHint ? (
            <p className="mt-2 text-[13px] leading-6 text-stone-400">{state.plan.ageHint}</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Sight({ ids, empty }: { ids: FieldId[]; empty: string }) {
  if (ids.length === 0) {
    return empty ? <p className="text-[13px] leading-6 text-stone-400">{empty}</p> : null;
  }
  return (
    <p className="text-[13px] leading-6 text-stone-600">
      {ids.map((id) => FIELD_META[id].label).join("、")}
    </p>
  );
}
