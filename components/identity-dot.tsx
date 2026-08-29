import { cn } from "@/lib/utils";

const TONES = {
  principal: "bg-[#FF8A7A]",
  agent: "bg-[#7C9CFF]",
  jia: "bg-[#67D4A3]",
  yi: "bg-[#F5C15C]",
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
