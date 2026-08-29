import { StatusChip } from "@/components/status-chip";

export function DenialBanner({ reason }: { reason: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <StatusChip tone="rose">403</StatusChip>
      <p className="text-[13px] leading-5 text-stone-500">{reason}</p>
    </div>
  );
}
