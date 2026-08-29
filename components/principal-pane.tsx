"use client";

import { useState } from "react";
import { ChatTranscript } from "@/components/chat-transcript";
import { DelegationCard } from "@/components/delegation-card";
import { GrantCard } from "@/components/grant-card";
import { IdentityDot } from "@/components/identity-dot";
import { NotificationList } from "@/components/notification-list";
import { WalletKeyCard } from "@/components/wallet-key-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { HAPPY_PATH_UTTERANCE } from "@/lib/rules";
import type { Demo } from "@/hooks/use-demo";
import type { GrantId } from "@/lib/types";

export function PrincipalPane({ demo }: { demo: Demo }) {
  const [draft, setDraft] = useState("");
  const { view, busy } = demo;
  const started = view.grants.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0 space-y-3">
        <div className="flex items-center gap-2">
          <IdentityDot tone="principal" />
          <p className="text-[14px] leading-5 text-[#C45C4A]">{view.principal.name}</p>
          <span className="text-[12px] text-stone-400">委託人</span>
        </div>

        <WalletKeyCard
          keyState={view.principal.key}
          busy={busy}
          passkeyAvailable={demo.passkeyAvailable}
          passkeyProblem={demo.passkeyProblem}
          localKeyUsable={demo.localKeyUsable}
          onRegister={(mode) => void demo.registerKey(mode)}
        />

        {view.principal.key.registered && !started ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void demo.sendChat(HAPPY_PATH_UTTERANCE)}
              className="rounded-full border border-stone-200/80 bg-white px-3 py-1 text-[13px] leading-5 text-stone-700 shadow-[0_1px_2px_rgba(28,25,23,0.04)] hover:bg-stone-50 disabled:opacity-40"
            >
              演示這句：{HAPPY_PATH_UTTERANCE}
            </button>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <ChatTranscript chat={view.chat} />

        <NotificationList
          notifications={view.notifications}
          busy={busy}
          onScan={() => void demo.scanNotifications()}
        />

        {view.grants.map((grant) => (
          <GrantCard
            key={grant.id}
            grant={grant}
            busy={busy}
            canSign={view.principal.key.registered}
            onSign={() => void demo.signGrant(grant.id as GrantId)}
            onRevoke={() => void demo.revoke(grant.id as GrantId)}
          />
        ))}

        <DelegationCard
          delegation={view.delegation}
          busy={busy}
          onStop={() => void demo.stopDelegation()}
          onRestore={() => void demo.restoreDelegation()}
          onSetMax={(level) => void demo.setMaxSensitivity(level)}
        />
      </div>

      <form
        className="flex shrink-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const message = draft.trim();
          if (!message) return;
          setDraft("");
          void demo.sendChat(message);
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="跟代理人說一句話…"
          disabled={busy}
          className="rounded-full"
        />
        <Button size="sm" className="rounded-full" disabled={busy || !draft.trim()} type="submit">
          送出
        </Button>
      </form>
    </div>
  );
}
