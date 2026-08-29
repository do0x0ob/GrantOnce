"use client";

import { useEffect, useRef } from "react";
import { SURFACE } from "@/components/surface";
import { cn } from "@/lib/utils";
import type { PrincipalView } from "@/lib/view";

/** The conversation with the agent. The rule engine's reasoning lands here. */
export function ChatTranscript({ chat }: { chat: PrincipalView["chat"] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = chat.at(-1)?.id;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lastId]);

  return (
    <section className={cn(SURFACE, "flex max-h-56 flex-col overflow-y-auto p-3")}>
      <ol className="space-y-2.5">
        {chat.map((message) => (
          <li key={message.id} className="space-y-0.5">
            <p
              className={cn(
                "text-[11px] leading-4",
                message.role === "user" ? "text-[#C45C4A]" : "text-stone-400",
              )}
            >
              {message.role === "user" ? "林曉晴" : message.role === "agent" ? "代理人" : "系統"}
            </p>
            <p className="whitespace-pre-wrap text-[12px] leading-5 text-stone-600">
              {message.text}
            </p>
          </li>
        ))}
      </ol>
      <div ref={endRef} />
    </section>
  );
}
