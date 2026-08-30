"use client";

import { ApplicationStatusCard } from "@/components/agent/application-status-card";
import { AuditCard } from "@/components/agent/audit-card";
import { ClaimsExplainerCard } from "@/components/agent/claims-explainer-card";
import { CardBoundary } from "@/components/agent/card-boundary";
import { EligibilityCard } from "@/components/agent/eligibility-card";
import { FallbackCard } from "@/components/agent/fallback-card";
import { ProgramPickerCard } from "@/components/agent/program-picker-card";
import { SignGrantCard } from "@/components/agent/sign-grant-card";
import { SuggestionsCard } from "@/components/agent/suggestions-card";
import type { Block } from "@/lib/agent/blocks/types";
import type { Demo } from "@/hooks/use-demo";

/** The only place a block becomes a component. */
function renderBlock(block: Block, key: string, demo: Demo) {
  switch (block.kind) {
    case "text":
      return (
        <p key={key} className="whitespace-pre-wrap text-[15px] leading-7 text-stone-700">
          {block.text}
        </p>
      );
    case "eligibility":
      return (
        <CardBoundary key={key} label="比對結果">
          <EligibilityCard payload={block.payload} />
        </CardBoundary>
      );
    case "signGrant":
      return (
        <CardBoundary key={key} label="授權匣">
          <SignGrantCard grantId={block.grantId} demo={demo} />
        </CardBoundary>
      );
    case "applicationStatus":
      return (
        <CardBoundary key={key} label="進度">
          <ApplicationStatusCard purpose={block.purpose} view={demo.view} />
        </CardBoundary>
      );
    case "programPicker":
      return (
        <CardBoundary key={key} label="選擇">
          <ProgramPickerCard
            payload={block.payload}
            busy={demo.busy}
            onPick={(text) => void demo.sendChat(text)}
          />
        </CardBoundary>
      );
    case "suggestions":
      return (
        <CardBoundary key={key} label="建議">
          <SuggestionsCard
            payload={block.payload}
            busy={demo.busy}
            onAsk={(utterance) => void demo.sendChat(utterance)}
          />
        </CardBoundary>
      );
    case "claimsExplainer":
      return (
        <CardBoundary key={key} label="會拿到什麼">
          <ClaimsExplainerCard payload={block.payload} />
        </CardBoundary>
      );
    case "auditTrail":
      return (
        <CardBoundary key={key} label="稽核">
          <AuditCard view={demo.view} />
        </CardBoundary>
      );
    case "toolError":
      return (
        <p key={key} className="text-[13px] leading-6 text-rose-700">
          {block.payload.message}
        </p>
      );
    default:
      return <FallbackCard key={key} kind={(block as { kind: string }).kind} />;
  }
}

/**
 * The conversation is the spine: each turn renders its own cards inline, in the
 * order the agent produced them, instead of leaving the reply in a collapsed
 * transcript and the capsules in a separate column.
 */
export function AgentThread({ demo }: { demo: Demo }) {
  return (
    <div className="flex flex-col gap-8">
      {demo.view.chat.map((message) => {
        if (message.role === "user") {
          return (
            <p
              key={message.id}
              className="self-end rounded-[20px] bg-stone-900 px-4 py-2 text-[15px] leading-7 text-stone-50"
            >
              {message.text}
            </p>
          );
        }

        const blocks = message.blocks ?? [];
        if (!blocks.length) {
          return (
            <p
              key={message.id}
              className="whitespace-pre-wrap text-[15px] leading-7 text-stone-700"
            >
              {message.text}
            </p>
          );
        }

        return (
          <div key={message.id} className="flex flex-col gap-5">
            {blocks.map((block, i) => renderBlock(block, `${message.id}:${i}`, demo))}
          </div>
        );
      })}
    </div>
  );
}
