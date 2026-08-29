"use client";

import { useState } from "react";
import { GrantCard } from "@/components/grant-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FIELD_META } from "@/lib/fields";
import { HAPPY_PATH_UTTERANCE } from "@/lib/rules";
import type { DemoState, GrantId } from "@/lib/types";
import { groupedFields } from "@/lib/view";

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

  const catalogGroups = groupedFields(state.vaultCatalog.map((c) => c.fieldId));
  const started = state.grants.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="shrink-0 space-y-1">
        <p className="text-[11px] tracking-[0.2em] text-stone-500">委託人</p>
        <h2 className="font-serif text-xl text-stone-900">{state.principal.name}</h2>
        <p className="text-xs leading-5 text-stone-600">{state.principal.summary}</p>
        <Badge variant="outline" className="rounded-md text-[11px]">
          合成資料 · 非真實個資
        </Badge>
      </header>

      <div className="shrink-0 space-y-2 rounded-xl border border-stone-800/15 bg-[#fbf7ee] p-3">
        <p className="text-xs font-medium text-stone-800">
          {started ? "已送出需求。接著分別核准下面兩匣。" : "第一步：送出這句話"}
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
          <h3 className="text-sm font-medium text-stone-800">授權匣</h3>
          {state.grants.length === 0 ? (
            <p className="rounded-lg border border-dashed border-stone-300 bg-white/60 px-3 py-3 text-sm text-stone-500">
              點上方按鈕後，這裡會出現兩張最小欄位匣。沒有一次交出全部資料的按鈕。
            </p>
          ) : (
            <div className="grid gap-2">
              {state.grants.map((grant) => (
                <GrantCard
                  key={grant.id}
                  grant={grant}
                  busy={busy}
                  onApprove={() => onApprove(grant.id)}
                  onRevoke={() => onRevoke(grant.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-stone-300/80 bg-[#fbf7ee] p-3">
          <p className="mb-2 text-[11px] tracking-wide text-stone-500">對話</p>
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

        <section className="space-y-2">
          <h3 className="text-sm font-medium text-stone-800">我的金庫目錄</h3>
          <p className="text-[11px] text-stone-500">
            只列出欄位名稱。所得在金庫，快樂路徑不會打開。
          </p>
          <div className="grid gap-2 rounded-xl border border-stone-300/80 bg-white/70 p-3">
            {catalogGroups.map(([group, ids]) => {
              const sealed = ids.some((id) => FIELD_META[id].sealed);
              return (
                <div key={group} className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm text-stone-800">{group}</p>
                    <p className="text-[11px] text-stone-500">
                      {ids.map((id) => FIELD_META[id].label).join("、")}
                    </p>
                  </div>
                  <Badge
                    variant={sealed ? "destructive" : "secondary"}
                    className="rounded-md"
                  >
                    {sealed ? "封存 · 不授權" : "可分匣"}
                  </Badge>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
