import { CardHead } from "@/components/agent/card-head";
import { SURFACE } from "@/components/surface";
import { cn } from "@/lib/utils";
import type { EligibilityPayload } from "@/lib/agent/blocks/types";

/** Why the rule engine matched, and what it chose not to ask for. */
export function EligibilityCard({ payload }: { payload: EligibilityPayload }) {
  return (
    <section className={cn(SURFACE, "space-y-4 px-6 py-5")}>
      <CardHead title="比對結果" sub="規則引擎判定 · 模型不決定授權" />

      <ul className="space-y-1.5">
        {payload.reasons.map((reason) => (
          <li key={reason} className="text-[14px] leading-6 text-stone-700">
            {reason}
          </li>
        ))}
      </ul>

      {payload.withheld.length ? (
        <div className="space-y-1 border-t border-stone-900/5 pt-3">
          <p className="text-[12px] leading-5 text-stone-500">沒有向你要的</p>
          <p className="text-[13px] leading-6 text-stone-600">
            {payload.withheld.join("、")}
          </p>
        </div>
      ) : null}

      {payload.ageHint ? (
        <p className="text-[12px] leading-5 text-stone-500">{payload.ageHint}</p>
      ) : null}
    </section>
  );
}
