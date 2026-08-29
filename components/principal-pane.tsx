"use client";

import { useState } from "react";
import { GrantCard } from "@/components/grant-card";
import { Badge } from "@/components/ui/badge";
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
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="shrink-0 border-b border-stone-300/70 pb-2">
        <p className="text-[11px] text-stone-500">委託人</p>
        <h2 className="font-serif text-xl leading-7 text-stone-900">{state.principal.name}</h2>
        <p className="text-[13px] leading-5 text-stone-600">{state.principal.summary}</p>
        <Badge variant="outline" className="mt-1 rounded-md text-[11px]">
          合成資料 · 非真實個資
        </Badge>
      </header>

      <div className="shrink-0 space-y-2 rounded-lg border border-stone-800/12 bg-[#fbf8f1] p-3">
        <p className="text-[13px] font-medium text-stone-800">
          {started ? "分別核准下面兩匣。" : "送出這句話，產生兩張匣。"}
        </p>
        <Button
          type="button"
          size="lg"
          className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left"
          disabled={busy || started}
          onClick={() => submit(HAPPY_PATH_UTTERANCE)}
        >
          演示這句：{HAPPY_PATH_UTTERANCE}
        </Button>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(draft);
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={HAPPY_PATH_UTTERANCE}
            disabled={busy}
            className="bg-white"
          />
          <Button type="submit" disabled={busy || !draft.trim()}>
            送出
          </Button>
        </form>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <section className="space-y-2">
          <h3 className="text-[13px] font-medium text-stone-800">授權文書</h3>
          {state.grants.length === 0 ? (
            <p className="rounded-lg border border-dashed border-stone-300 px-3 py-3 text-[13px] text-stone-500">
              兩張匣會出現在這裡。沒有一次交出全部資料的按鈕。
            </p>
          ) : (
            <div className="grid gap-2">
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
          <h3 className="text-[13px] font-medium text-stone-800">假 MyData 金庫</h3>
          <VaultHoldings state={state} />
        </section>

        <section className="rounded-lg border border-stone-300/80 bg-[#fbf8f1] p-3">
          <p className="mb-2 text-[11px] text-stone-500">對話</p>
          <div className="space-y-2">
            {state.chat.map((msg) => (
              <div
                key={msg.id}
                className={
                  msg.role === "user"
                    ? "ml-8 rounded-lg bg-stone-800 px-3 py-2 text-sm text-stone-50"
                    : "mr-6 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm leading-6 whitespace-pre-wrap text-stone-800"
                }
              >
                {msg.text}
              </div>
            ))}
          </div>
        </section>
      </div>
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
          <div
            key={group}
            className={
              sealed
                ? "rounded-lg border-2 border-stone-800/20 bg-[#fbf8f1] p-3"
                : "rounded-lg border border-stone-300/80 bg-white/70 p-3"
            }
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[13px] font-medium text-stone-900">{group}</p>
              <Badge variant={sealed ? "destructive" : "secondary"} className="rounded-md">
                {sealed ? "在金庫 · 未授權" : "可分匣"}
              </Badge>
            </div>
            <dl className="space-y-1">
              {rows.map((row) => (
                <div key={row.fieldId} className="grid grid-cols-[6.5rem_1fr] gap-2 text-[13px] leading-5">
                  <dt className="text-stone-500">{row.label}</dt>
                  <dd className="font-medium text-stone-900">{row.value}</dd>
                </div>
              ))}
            </dl>
            {sealed ? (
              <p className="mt-2 text-[13px] font-medium text-red-900">
                {heldOut ? "未進入任何授權匣" : "錯誤：所得已被列入匣"}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
