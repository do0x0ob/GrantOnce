"use client";

import { CardHead } from "@/components/agent/card-head";
import { SURFACE } from "@/components/surface";
import { cn } from "@/lib/utils";
import type { ProgramPickerPayload } from "@/lib/agent/blocks/types";

/**
 * A card that talks back.
 *
 * Without this the agent has to ask "which one?" in prose and then hope it
 * parses the reply. With it the choice returns as structure, and the model —
 * or the rule engine — never has to read free text twice.
 */
export function ProgramPickerCard({
  payload,
  busy,
  onPick,
}: {
  payload: ProgramPickerPayload;
  busy: boolean;
  onPick: (text: string) => void;
}) {
  return (
    <section className={cn(SURFACE, "space-y-4 px-6 py-5")}>
      <CardHead title={payload.question} sub="點一下就好，不用打字" />
      <div className="flex flex-col gap-2">
        {payload.options.map((option) => (
          <button
            key={option.purpose}
            type="button"
            disabled={busy}
            onClick={() => onPick(option.utterance)}
            className="rounded-[20px] bg-white/70 px-4 py-3 text-left transition-transform hover:-translate-y-0.5 disabled:opacity-40"
          >
            <span className="block text-[14px] leading-6 text-stone-900">{option.title}</span>
            <span className="mt-0.5 block text-[12px] leading-5 text-stone-500">
              {option.detail}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
