import type { ReactNode } from "react";

const TONES = {
  stone: "bg-[var(--wash-clay)] text-[var(--ink-soft)]",
  rose: "bg-[var(--wash-risk)] text-[var(--orchid-deep)]",
  mint: "bg-[var(--wash-ok)] text-[var(--sage)]",
  amber: "bg-[var(--wash-clay)] text-[var(--clay)]",
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
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] leading-4 ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
