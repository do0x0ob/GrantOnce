"use client";

import { useState } from "react";
import { AgentThread } from "@/components/agent/thread";
import { AuthorizeRail } from "@/components/authorize-rail";
import { NotificationList } from "@/components/notification-list";
import { PageIntro } from "@/components/page-intro";
import { WalletKeyCard } from "@/components/wallet-key-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FLOOD_UTTERANCE } from "@/lib/catalog";
import { HAPPY_PATH_UTTERANCE } from "@/lib/rules";
import type { Demo } from "@/hooks/use-demo";
import { cn } from "@/lib/utils";

function authorizePhase(demo: Demo) {
  const { view } = demo;
  if (!view.principal.key.registered) return "onboard" as const;
  if (view.grants.length === 0) return "ask" as const;
  if (view.grants.some((g) => g.status === "proposed" || g.status === "expired")) {
    return "review" as const;
  }
  if (view.grants.some((g) => g.status === "signed")) return "waiting" as const;
  return "done" as const;
}

export function PrincipalPane({
  demo,
  onOpenAgency,
}: {
  demo: Demo;
  onOpenAgency: () => void;
}) {
  const [draft, setDraft] = useState("");
  const { view, busy } = demo;
  const phase = authorizePhase(demo);
  // The conversation is the surface, so it must not be gated on a capsule
  // existing: a reply that answers a question without proposing anything —
  // "who read my data", "what would they get" — has to be visible too.
  const started = view.chat.some((message) => message.role === "user");
  const pending = view.grants.filter((g) => g.status === "proposed").length;
  const submitted = Object.values(view.inboxes).some((box) => box.submittedAt);
  const received = Object.values(view.inboxes).some((box) => box.receivedAt);

  return (
    <div className="flex min-h-[calc(100svh-4rem)] flex-col">
      <div
        className={cn(
          "mx-auto flex w-full flex-1",
          started
            ? "max-w-[84rem] flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_40rem_minmax(0,1fr)]"
            : "max-w-[40rem] flex-col",
        )}
      >
        {started ? (
          <aside className="px-6 pt-8 lg:sticky lg:top-20 lg:self-start lg:justify-self-end lg:px-4 lg:pt-10">
            <AuthorizeRail demo={demo} />
          </aside>
        ) : null}

        <div className="mx-auto flex w-full max-w-[40rem] flex-1 flex-col px-6 pb-8 pt-10 sm:px-8">
          {phase === "onboard" ? (
            <WalletKeyCard
              keyState={view.principal.key}
              busy={busy}
              passkeyAvailable={demo.passkeyAvailable}
              passkeyProblem={demo.passkeyProblem}
              localKeyUsable={demo.localKeyUsable}
              onRegister={(mode) => void demo.registerKey(mode)}
            />
          ) : null}

          {phase === "ask" && !started ? (
            <div className="flex flex-1 flex-col items-start justify-center py-10">
              <PageIntro kicker={view.principal.name} title="想辦什麼？">
                跟代理人說你現在的情況。資格由規則引擎決定，模型不決定授權。
              </PageIntro>
              <div className="mt-10 flex max-w-full flex-col items-start gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void demo.sendChat(HAPPY_PATH_UTTERANCE)}
                  className="max-w-full rounded-full bg-white px-5 py-3 text-left text-[15px] leading-6 text-stone-800 shadow-[0_1px_0_rgba(26,24,20,0.04),0_18px_40px_-28px_rgba(26,24,20,0.35)] transition-transform hover:-translate-y-0.5 disabled:opacity-40"
                >
                  演示這句：{HAPPY_PATH_UTTERANCE}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void demo.sendChat(FLOOD_UTTERANCE)}
                  className="max-w-full rounded-full bg-white px-5 py-3 text-left text-[15px] leading-6 text-stone-800 shadow-[0_1px_0_rgba(26,24,20,0.04),0_18px_40px_-28px_rgba(26,24,20,0.35)] transition-transform hover:-translate-y-0.5 disabled:opacity-40"
                >
                  問真實世界：{FLOOD_UTTERANCE}
                </button>
              </div>
            </div>
          ) : null}

          {started ? (
            <div className="space-y-10 pb-8">
              {view.grants.length ? (
                <div className="space-y-4">
                  <PageIntro
                    kicker={view.principal.name}
                    title={
                      phase === "review"
                        ? pending > 1
                          ? `有 ${pending} 張授權等你簽署`
                          : "請檢視並簽署"
                        : phase === "waiting"
                          ? "授權已成立"
                          : submitted
                            ? "申請已送出"
                            : received
                              ? "機關已收到述詞"
                              : "授權進度"
                    }
                  >
                    {phase === "review" ? (
                      <p>機關只會拿到匣裡的述詞。實際落在哪一格，要等兌現後才看得到。</p>
                    ) : phase === "waiting" ? (
                      <p>你已簽署。接下來由請求機關出示持有證明，資料來源驗證後才會直接交付。</p>
                    ) : (
                      <p>已交付的述詞收不回來。防線是一開始就少給。</p>
                    )}
                  </PageIntro>
                  {phase === "waiting" ? (
                    <Button size="lg" variant="secondary" onClick={onOpenAgency}>
                      前往機關收件匣
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <NotificationList
                notifications={view.notifications}
                busy={busy}
                onScan={() => void demo.scanNotifications()}
                onAcknowledge={(id) => void demo.acknowledge(id)}
              />

              <AgentThread demo={demo} />
            </div>
          ) : null}
        </div>

        {started ? <div className="hidden lg:block" aria-hidden /> : null}
      </div>

      {phase !== "onboard" ? (
        <div className="sticky bottom-0 bg-gradient-to-t from-[#E8E4DE] via-[#E8E4DE] to-transparent pb-5 pt-8">
          <form
            className="mx-auto flex w-full max-w-[40rem] items-center gap-2 px-6 sm:px-8"
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
            />
            <Button size="lg" disabled={busy || !draft.trim()} type="submit">
              送出
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
