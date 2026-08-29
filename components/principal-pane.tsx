"use client";

import { GrantCard } from "@/components/grant-card";
import { IdentityDot } from "@/components/identity-dot";
import { HAPPY_PATH_UTTERANCE } from "@/lib/rules";
import type { DemoState, GrantId } from "@/lib/types";

export function PrincipalPane({
  state,
  busy,
  onSend,
  onApprove,
  onRevoke,
}: {
  state: DemoState;
  busy: boolean;
  onSend: (message: string) => Promise<unknown>;
  onApprove: (id: GrantId) => Promise<unknown>;
  onRevoke: (id: GrantId) => Promise<unknown>;
}) {
  const started = state.grants.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="shrink-0 space-y-2.5">
        <div className="flex items-center gap-2">
          <IdentityDot tone="principal" />
          <p className="text-[14px] leading-5 text-[#C45C4A]">{state.principal.name}</p>
          <span className="text-[12px] text-stone-400">委託人</span>
        </div>
        {started ? (
          <p className="text-[13px] leading-5 text-stone-400">分別核准兩匣</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onSend(HAPPY_PATH_UTTERANCE)}
              className="rounded-full border border-stone-200/80 bg-white px-3 py-1 text-[13px] leading-5 text-stone-700 shadow-[0_1px_2px_rgba(28,25,23,0.04)] hover:bg-stone-50 disabled:opacity-40"
            >
              演示這句
            </button>
            <span className="text-[13px] leading-5 text-stone-400">看我能申請什麼</span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {state.grants.length === 0 ? (
          <p className="text-[13px] leading-6 text-stone-400">匣卡會出現在這裡。</p>
        ) : (
          state.grants.map((grant) => (
            <GrantCard
              key={grant.id}
              grant={grant}
              issuer={
                grant.issuer === state.principal.id
                  ? `${state.principal.name}（${grant.issuer}）`
                  : grant.issuer
              }
              busy={busy}
              onApprove={() => onApprove(grant.id)}
              onRevoke={() => onRevoke(grant.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
