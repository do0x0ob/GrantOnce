import type { ReactNode } from "react";

export function StatusChip({
  tone = "stone",
  children,
}: {
  tone?: "stone" | "rose" | "mint" | "amber";
  children: ReactNode;
}) {
  const tones = {
    stone: "bg-stone-100/90 text-stone-500",
    rose: "bg-rose-50 text-rose-600",
    mint: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] leading-4 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function DenialBanner({ reason }: { reason: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <StatusChip tone="rose">403</StatusChip>
      <p className="text-[13px] leading-5 text-stone-500">{reason}</p>
    </div>
  );
}
