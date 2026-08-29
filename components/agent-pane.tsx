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
  const income = groups.find(([group]) => group === "所得");
  const rest = groups.filter(([group]) => group !== "所得");

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="flex items-center gap-2">
        <IdentityDot tone="agent" />
        <p className="text-[14px] leading-5 text-stone-700">代理人</p>
      </div>

      <section className={`${SURFACE} px-5 py-4`}>
        <div className="mb-3 flex items-center gap-1.5">
          <Lock className="size-3 text-stone-400" strokeWidth={1.75} aria-hidden />
          <p className="text-[13px] leading-5 text-stone-400">假 MyData 金庫</p>
        </div>

        {income ? (
          <IncomeBlock
            ids={income[1]}
            holdings={holdings}
            heldOut={heldOut}
          />
        ) : null}

        <div className="mt-4 space-y-2.5">
          {rest.map(([group, ids]) => {
            const rows = ids
              .map((id) => holdings.find((h) => h.fieldId === id))
              .filter((row): row is NonNullable<typeof row> => Boolean(row));
            return (
              <div key={group} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p className="text-[13px] leading-6 text-stone-800">{group}</p>
                <StatusChip>可分匣</StatusChip>
                <p className="text-[13px] leading-6 text-stone-400">
                  {rows.map((row) => row.label).join("、")}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <p className="text-[13px] leading-6 text-stone-400">
        現在可讀{" "}
        <span className="text-stone-600">
          <Sight ids={sight.readableNow} empty="還沒有有效匣。" />
        </span>
        {sight.consumed.length > 0 ? (
          <>
            <span className="mx-2 text-stone-300">·</span>
            已耗用{" "}
            <span className="text-stone-600">
              <Sight ids={sight.consumed} empty="" />
            </span>
          </>
        ) : null}
      </p>
      {state.plan?.ageHint ? (
        <p className="text-[13px] leading-6 text-stone-400">{state.plan.ageHint}</p>
      ) : null}
    </div>
  );
}

function IncomeBlock({
  ids,
  holdings,
  heldOut,
}: {
  ids: FieldId[];
  holdings: DemoState["vaultHoldings"];
  heldOut: boolean;
}) {
  const rows = ids
    .map((id) => holdings.find((h) => h.fieldId === id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="text-[14px] leading-5 text-stone-800">所得</p>
        <StatusChip tone="rose">在金庫 · 未入匣</StatusChip>
      </div>
      <dl className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.fieldId} className="grid grid-cols-[6.2rem_1fr] gap-2 text-[13px] leading-6">
            <dt className="text-stone-400">{row.label}</dt>
            <dd className="text-stone-800">
              {row.value}
              <Lock
                className="ml-1 inline size-3 align-[-2px] text-stone-300"
                strokeWidth={1.75}
                aria-hidden
              />
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-[13px] leading-5 text-stone-400">
        {heldOut ? "未進入任何授權匣" : "錯誤：所得已被列入匣"}
      </p>
    </div>
  );
}

function Sight({ ids, empty }: { ids: FieldId[]; empty: string }) {
  if (ids.length === 0) return empty;
  return ids.map((id) => FIELD_META[id].label).join("、");
}
