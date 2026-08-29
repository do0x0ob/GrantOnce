import type { ReactNode } from "react";

const TONES = {
  stone: "bg-stone-100/90 text-stone-500",
  rose: "bg-rose-50 text-rose-600",
  mint: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
} as const;

export type ChipTone = keyof typeof TONES;

export function StatusChip({
  tone = "stone",
  children,
}: {
  tone?: ChipTone;
  children: ReactNode;
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-4 ${TONES[tone]}`}>
      {children}
    </span>
  );
}
