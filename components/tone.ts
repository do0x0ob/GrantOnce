import type { Sensitivity } from "@/lib/claims";

/** One place for the sensitivity palette; the chip and the value read the same map. */
export const SENSITIVITY_CHIP: Record<Sensitivity, string> = {
  predicate: "bg-emerald-50 text-emerald-800",
  pseudonym: "bg-sky-50 text-sky-800",
  personal: "bg-amber-50 text-amber-800",
  special: "bg-rose-50 text-rose-800",
};

export const SENSITIVITY_TEXT: Record<Sensitivity, string> = {
  predicate: "text-emerald-700",
  pseudonym: "text-sky-700",
  personal: "text-amber-700",
  special: "text-rose-700",
};

export const PAPER = "#EFEAE3";
