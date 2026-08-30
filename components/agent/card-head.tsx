import type { ReactNode } from "react";

/**
 * The shared head. `sub` carries the nature of the thing, not a restatement of
 * the title — for a capsule that is its audience and its one-time expiry, which
 * is what the reader needs before deciding to sign.
 */
export function CardHead({
  title,
  sub,
  status,
}: {
  title: string;
  sub?: string;
  status?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h3 className="text-[19px] leading-7 tracking-tight text-stone-900">{title}</h3>
        {sub ? <p className="text-[12px] leading-5 text-stone-500">{sub}</p> : null}
      </div>
      {status ? <div className="shrink-0">{status}</div> : null}
    </header>
  );
}
