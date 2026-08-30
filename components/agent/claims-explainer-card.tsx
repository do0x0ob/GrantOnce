import { CardHead } from "@/components/agent/card-head";
import { SURFACE } from "@/components/surface";
import { cn } from "@/lib/utils";
import type { ClaimsExplainerPayload } from "@/lib/agent/blocks/types";

/** Answers "what would they actually get" without needing a grant to exist. */
export function ClaimsExplainerCard({ payload }: { payload: ClaimsExplainerPayload }) {
  return (
    <section className={cn(SURFACE, "space-y-5 px-6 py-5")}>
      <CardHead title="機關會拿到什麼" sub="述詞，不是原始欄位" />

      {payload.purposes.map((purpose) => (
        <div key={purpose.purpose} className="space-y-1.5">
          <p className="text-[13px] leading-6 text-stone-900">{purpose.title}</p>
          <ul className="space-y-1">
            {purpose.claims.map((claim) => (
              <li
                key={claim.label}
                className="flex items-baseline justify-between gap-3 text-[13px] leading-6"
              >
                <span className="text-stone-700">{claim.label}</span>
                <span className="shrink-0 text-[12px] text-stone-400">{claim.shape}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {payload.withheld.length ? (
        <div className="space-y-2 border-t border-stone-900/5 pt-4">
          <p className="text-[12px] leading-5 text-stone-500">永遠不會給出去的</p>
          {payload.withheld.map((item) => (
            <div key={item.label} className="text-[13px] leading-6">
              <span className="text-stone-900">{item.label}</span>
              <span className="text-stone-500">　{item.basis}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
