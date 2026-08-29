"use client";

import { useState } from "react";
import { GrantCard } from "@/components/grant-card";
import { IdentityDot } from "@/components/identity-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HAPPY_PATH_UTTERANCE } from "@/lib/rules";
import type { DemoState, GrantId } from "@/lib/types";
import { groupedFields, incomeNeverGranted } from "@/lib/view";

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
  const [draft, setDraft] = useState("");

  async function submit(text: string) {
    const message = text.trim();
    if (!message) return;
    setDraft("");
    await onSend(message);
  }

  const started = state.grants.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="mb-4 flex items-center gap-2.5">
        <IdentityDot tone="principal" className="size-3" />
        <div>
          <h2 className="text-[15px] font-medium tracking-tight text-neutral-900">
            {state.principal.name}
          </h2>
          <p className="text-[12px] text-neutral-500">委託人 · 合成資料</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        <section className="space-y-2">
          {state.grants.length === 0 ? (
            <p className="px-1 text-[13px] leading-5 text-neutral-500">
              送出一句話後，兩張匣會出現在這裡。沒有一次交出全部資料的按鈕。
            </p>
          ) : (
            <div className="grid gap-3">
              {state.grants.map((grant) => (
                <GrantCard
                  key={grant.id}
                  grant={grant}
                  issuer={state.principal.name}
                  busy={busy}
                  onApprove={() => onApprove(grant.id)}
                  onRevoke={() => onRevoke(grant.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <p className="px-1 text-[12px] text-neutral-500">假 MyData 金庫</p>
          <VaultHoldings state={state} />
        </section>

        <div className="space-y-2 pb-2">
          {state.chat.map((msg) => (
            <div
              key={msg.id}
              className={
                msg.role === "user"
                  ? "ml-10 rounded-[22px] bg-neutral-900 px-4 py-2.5 text-[13px] leading-5 whitespace-pre-wrap text-white"
                  : "mr-8 rounded-[22px] bg-white px-4 py-2.5 text-[13px] leading-5 whitespace-pre-wrap text-neutral-800 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
              }
            >
              {msg.text}
            </div>
          ))}
        </div>
      </div>

      <form
        className="mt-3 shrink-0 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(draft);
        }}
      >
        {!started ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => submit(HAPPY_PATH_UTTERANCE)}
            className="w-full rounded-full bg-neutral-900 px-4 py-2.5 text-left text-[13px] leading-5 text-white disabled:opacity-50"
          >
            {HAPPY_PATH_UTTERANCE}
          </button>
        ) : (
          <p className="px-1 text-[12px] text-neutral-500">分別核准上面兩匣。</p>
        )}
        <div className="flex items-center gap-2 rounded-full bg-white p-1 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="傳一句話…"
            disabled={busy}
            className="h-10 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button
            type="submit"
            disabled={busy || !draft.trim()}
            className="h-10 rounded-full px-4"
          >
            送出
          </Button>
        </div>
      </form>
    </div>
  );
}

function VaultHoldings({ state }: { state: DemoState }) {
  const holdings = state.vaultHoldings ?? [];
  const groups = groupedFields(holdings.map((h) => h.fieldId));
  const heldOut = incomeNeverGranted(state);

  return (
    <div className="space-y-2">
      {groups.map(([group, ids]) => {
        const rows = ids
          .map((id) => holdings.find((h) => h.fieldId === id))
          .filter((row): row is NonNullable<typeof row> => Boolean(row));
        const sealed = rows.some((row) => row.sealed);
        return (
          <div key={group} className="rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[13px] font-medium text-neutral-900">{group}</p>
              <span
                className={
                  sealed
                    ? "rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700"
                    : "rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500"
                }
              >
                {sealed ? "在金庫 · 未授權" : "可分匣"}
              </span>
            </div>
            <dl className="space-y-1">
              {rows.map((row) => (
                <div key={row.fieldId} className="grid grid-cols-[6.5rem_1fr] gap-2 text-[13px] leading-5">
                  <dt className="text-neutral-500">{row.label}</dt>
                  <dd className="text-neutral-900">{row.value}</dd>
                </div>
              ))}
            </dl>
            {sealed ? (
              <p className="mt-2 text-[13px] font-medium text-rose-700">
                {heldOut ? "未進入任何授權匣" : "錯誤：所得已被列入匣"}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
