import { CardHead } from "@/components/agent/card-head";
import { SURFACE } from "@/components/surface";
import { cn } from "@/lib/utils";
import type { WorldSearchPayload } from "@/lib/agent/blocks/types";

/**
 * What public sources say exists.
 *
 * Its own card, visibly separate from the capsules below it: finding a benefit
 * in the world is not the same as this runtime being able to authorise it, and
 * a search result rendered like a proposal would blur exactly that line.
 */
export function WorldSearchCard({ payload }: { payload: WorldSearchPayload }) {
  return (
    <section className={cn(SURFACE, "space-y-4 px-6 py-5")}>
      <CardHead title="真實世界有什麼" sub="公開資料 · 不是授權，也沒讀金庫" />

      <ul className="space-y-3">
        {payload.findings.map((finding) => (
          <li key={finding.url || finding.title} className="space-y-0.5">
            {finding.url ? (
              <a
                href={finding.url}
                target="_blank"
                rel="noreferrer"
                className="text-[14px] leading-6 text-stone-900 underline decoration-stone-900/20 underline-offset-4"
              >
                {finding.title}
              </a>
            ) : (
              <p className="text-[14px] leading-6 text-stone-900">{finding.title}</p>
            )}
            {finding.publisher ? (
              <p className="text-[11px] leading-4 text-stone-400">{finding.publisher}</p>
            ) : null}
            {finding.snippet ? (
              <p className="text-[13px] leading-6 text-stone-600">{finding.snippet}</p>
            ) : null}
          </li>
        ))}
      </ul>

      {payload.note ? (
        <p className="border-t border-stone-900/5 pt-3 text-[12px] leading-5 text-stone-500">
          {payload.note}
        </p>
      ) : null}
    </section>
  );
}
