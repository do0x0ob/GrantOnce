"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { PrincipalView } from "@/lib/view";

/** The conversation with the agent. The rule engine's reasoning lands here. */
export function ChatTranscript({
  chat,
  compact = false,
}: {
  chat: PrincipalView["chat"];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(!compact);
  const last = chat.at(-1);

  if (chat.length === 0) return null;

  if (compact && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-left text-[14px] leading-6 text-stone-400 transition-colors hover:text-stone-600"
      >
        與代理人的對話 · {chat.length} 則
        {last ? <span className="mt-0.5 block truncate text-stone-500">{last.text}</span> : null}
      </button>
    );
  }

  return (
    <section className="space-y-5">
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[13px] leading-5 text-stone-400 hover:text-stone-600"
        >
          收起對話
        </button>
      ) : null}
      <ol className="space-y-5">
        {chat.map((message) => (
          <li key={message.id} className="space-y-1">
            <p
              className={cn(
                "text-[12px] leading-4 tracking-[0.03em]",
                message.role === "user" ? "text-[#B54A3C]" : "text-stone-400",
              )}
            >
              {message.role === "user" ? "林曉晴" : message.role === "agent" ? "代理人" : "系統"}
            </p>
            <p className="whitespace-pre-wrap text-[15px] leading-7 text-stone-600">
              {message.text}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
