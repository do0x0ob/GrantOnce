"use client";

import { GrantCard } from "@/components/grant-card";
import { SURFACE } from "@/components/surface";
import { cn } from "@/lib/utils";
import type { Demo } from "@/hooks/use-demo";
import type { GrantId } from "@/lib/types";

/**
 * The signing card names a grant rather than embedding one.
 *
 * sup-wallet persists a "this card already ran" flag in local storage because
 * the chain is too expensive to ask. Here the server already knows: the grant's
 * status is authoritative, so a reloaded thread cannot offer to sign something
 * that was signed, and no second source of truth is introduced for the one
 * thing this project is most careful about.
 */
export function SignGrantCard({ grantId, demo }: { grantId: GrantId; demo: Demo }) {
  const grant = demo.view.grants.find((g) => g.id === grantId);

  if (!grant) {
    return (
      <div className={cn(SURFACE, "px-6 py-5")}>
        <p className="text-[13px] leading-6 text-stone-500">
          這張匣 {grantId} 已經不在了。條件變了就會重新提案一張新的——舊的不會沿用。
        </p>
      </div>
    );
  }

  return (
    <GrantCard
      grant={grant}
      busy={demo.busy}
      canSign={demo.view.principal.key.registered && demo.localKeyUsable}
      onSign={() => void demo.signGrant(grantId)}
      onRevoke={() => void demo.revoke(grantId)}
    />
  );
}
