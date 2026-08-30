import { cn } from "@/lib/utils";

const TONES = {
  principal: "bg-[var(--orchid)]",
  agent: "bg-[var(--ink-soft)]",
  jia: "bg-[var(--sage)]",
  yi: "bg-[var(--clay)]",
} as const;

export function IdentityDot({
  tone,
  className,
}: {
  tone: keyof typeof TONES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2.5 shrink-0 rounded-full", TONES[tone], className)}
    />
  );
}
