import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageIntro({
  kicker,
  title,
  children,
  className,
}: {
  kicker?: string;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("space-y-3", className)}>
      {kicker ? (
        <p className="text-[13px] leading-5 tracking-[0.04em] text-stone-400">{kicker}</p>
      ) : null}
      <h1 className="text-[2rem] font-medium leading-[1.2] tracking-tight text-stone-900">
        {title}
      </h1>
      {children ? (
        <div className="text-[16px] leading-7 text-stone-500">{children}</div>
      ) : null}
    </header>
  );
}
