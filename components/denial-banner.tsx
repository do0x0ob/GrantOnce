import { StatusChip } from "@/components/status-chip";

export function DenialBanner({ reason }: { reason: string }) {
  return (
    <div role="alert" className="space-y-2 rounded-2xl bg-[var(--wash-risk)] px-4 py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <StatusChip tone="rose">403</StatusChip>
        <p className="text-[13px] leading-5 text-[var(--orchid-deep)]">這次兌現被拒絕</p>
      </div>
      <p className="text-[15px] leading-6 text-stone-600">{reason}</p>
    </div>
  );
}
