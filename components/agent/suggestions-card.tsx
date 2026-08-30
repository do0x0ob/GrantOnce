"use client";

import { CardHead } from "@/components/agent/card-head";
import { SURFACE } from "@/components/surface";
import { cn } from "@/lib/utils";
import type { SuggestionsPayload } from "@/lib/agent/blocks/types";

/**
 * What the agent can be asked, as buttons.
 *
 * The vocabulary is finite because a rule engine decides eligibility, not a
 * model. Rather than apologise for that, an unrecognised question answers with
 * the things that do work — and the reply comes back as a chosen utterance, so
 * nothing has to be parsed twice.
 */
export function SuggestionsCard({
  payload,
  busy,
  onAsk,
}: {
  payload: SuggestionsPayload;
  busy: boolean;
  onAsk: (utterance: string) => void;
}) {
  return (
    <section className={cn(SURFACE, "space-y-4 px-6 py-5")}>
      <CardHead title={payload.question} sub="點一下就送出，不用打字" />
      <div className="flex flex-wrap gap-2">
        {payload.options.map((option) => (
          <button
            key={option.utterance}
            type="button"
            disabled={busy}
            onClick={() => onAsk(option.utterance)}
            className="rounded-full bg-white/70 px-4 py-2 text-[13px] leading-6 text-stone-700 transition-transform hover:-translate-y-0.5 disabled:opacity-40"
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}
