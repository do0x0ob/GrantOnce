"use client";

import { ApplicationStatusCard } from "@/components/agent/application-status-card";
import { CardBoundary } from "@/components/agent/card-boundary";
import type { Demo } from "@/hooks/use-demo";
import type { PurposeId } from "@/lib/purposes";
import type { PrincipalView } from "@/lib/view";

function railPurposes(view: PrincipalView): PurposeId[] {
  const seen = new Set<string>();
  const out: PurposeId[] = [];
  const add = (purpose: PurposeId) => {
    if (seen.has(purpose)) return;
    seen.add(purpose);
    out.push(purpose);
  };
  for (const request of view.serviceRequests) add(request.purpose);
  for (const message of view.chat) {
    for (const block of message.blocks ?? []) {
      if (block.kind === "applicationStatus") add(block.purpose);
    }
  }
  return out;
}

/** Compact side notes. The conversation stays the main column. */
export function AuthorizeRail({ demo }: { demo: Demo }) {
  const { view } = demo;
  const purposes = railPurposes(view);
  if (!purposes.length) return null;

  return (
    <div className="flex gap-3 overflow-x-auto [scrollbar-width:none] lg:w-[15.5rem] lg:flex-col lg:overflow-visible">
      {purposes.map((purpose) => (
        <CardBoundary key={purpose} label="進度">
          <ApplicationStatusCard purpose={purpose} view={view} />
        </CardBoundary>
      ))}
    </div>
  );
}
