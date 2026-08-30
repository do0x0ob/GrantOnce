import type { Sensitivity } from "@/lib/claims";

/** Morandi washes — same three hues as the rest of the product. */
export const SENSITIVITY_CHIP: Record<Sensitivity, string> = {
  predicate: "bg-[var(--wash-ok)] text-[var(--sage)]",
  pseudonym: "bg-[var(--wash-orchid)] text-[var(--orchid)]",
  personal: "bg-[var(--wash-clay)] text-[var(--clay)]",
  special: "bg-[var(--wash-risk)] text-[var(--orchid-deep)]",
};

export const SENSITIVITY_TEXT: Record<Sensitivity, string> = {
  predicate: "text-[var(--sage)]",
  pseudonym: "text-[var(--orchid)]",
  personal: "text-[var(--clay)]",
  special: "text-[var(--orchid-deep)]",
};

export const PAPER = "#E8E4DE";
