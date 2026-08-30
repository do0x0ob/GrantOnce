import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Same width as the header, so pages line up with the nav. */
export function PageFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[84rem] px-6 py-10 sm:px-8 lg:px-10", className)}>
      {children}
    </div>
  );
}

/** Two equal columns on PC. Stacks on small screens. */
export function PageSplit({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid items-start gap-8 lg:grid-cols-2 lg:gap-x-12 xl:gap-x-16",
        className,
      )}
    >
      {children}
    </div>
  );
}
