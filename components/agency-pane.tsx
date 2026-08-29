"use client";

import type { ReactNode } from "react";
import { AuditTimeline } from "@/components/audit-timeline";
import { DenialBanner } from "@/components/denial-banner";
import { IdentityDot } from "@/components/identity-dot";
import { Button } from "@/components/ui/button";
import { FIELD_META } from "@/lib/fields";
import type { DemoState, Envelope, GrantId } from "@/lib/types";
import { envelopeHasIncome, GRANT_STATUS_LABEL } from "@/lib/view";

export function AgencyPane({
  state,
  busy,
  onOverscope,
  onSubmitJia,
  onReplayJia,
}: {
  state: DemoState;
  busy: boolean;
  onOverscope: () => Promise<unknown>;
  onSubmitJia: () => Promise<unknown>;
  onReplayJia: () => Promise<unknown>;
}) {
  const yiActive = state.grants.find((g) => g.id === "G-乙")?.status === "active";
  const jiaSubmitted = Boolean(state.agencies.jia.submittedAt);
  const jiaFetched = Boolean(state.envelopes["G-甲"].fetchedAt);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="mb-4">
        <h2 className="text-[15px] font-medium tracking-tight text-neutral-900">甲與乙各看一匣</h2>
        <p className="text-[12px] text-neutral-500">機關收件匣 · 稽核</p>
      </header>

      <div className="mb-3 grid shrink-0 gap-3 md:grid-cols-2">
        <AgencyCard
          title="甲｜新北市社會局"
          program="育兒津貼"
          grantId="G-甲"
          tone="jia"
          state={state}
          envelope={state.envelopes["G-甲"]}
        >
          <Button
            size="sm"
            className="rounded-full"
            disabled={busy || !jiaFetched || jiaSubmitted}
            onClick={() => void onSubmitJia()}
          >
            送出申請
          </Button>
          <Button
            size="sm"
            variant={jiaSubmitted ? "destructive" : "outline"}
            className="rounded-full"
            disabled={busy || !jiaSubmitted}
            onClick={() => void onReplayJia()}
          >
            重放擷取
          </Button>
        </AgencyCard>

        <AgencyCard
          title="乙｜經濟部 × 台電"
          program="冷氣汰換補助"
          grantId="G-乙"
          tone="yi"
          state={state}
          envelope={state.envelopes["G-乙"]}
        >
          <Button
            size="sm"
            variant="destructive"
            className="rounded-full"
            disabled={busy || !yiActive}
            onClick={() => void onOverscope()}
          >
            索取戶籍謄本
          </Button>
        </AgencyCard>
      </div>

      <section className="min-h-0 flex-1 overflow-auto rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <h3 className="mb-3 text-[12px] text-neutral-500">稽核時間線</h3>
        <AuditTimeline entries={state.audit} state={state} />
      </section>
    </div>
  );
}

function AgencyCard({
  title,
  program,
  grantId,
  tone,
  state,
  envelope,
  children,
}: {
  title: string;
  program: string;
  grantId: GrantId;
  tone: "jia" | "yi";
  state: DemoState;
  envelope: Envelope;
  children: ReactNode;
}) {
  const grant = state.grants.find((g) => g.id === grantId);
  const agency = grantId === "G-甲" ? state.agencies.jia : state.agencies.yi;
  const entries = Object.entries(envelope.fields);
  const leakedIncome = envelopeHasIncome(state, grantId);

  return (
    <article className="flex flex-col gap-2 rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <IdentityDot tone={tone} />
          <div>
            <p className="text-[13px] font-medium text-neutral-900">{title}</p>
            <p className="text-[12px] text-neutral-500">
              {program} · {grantId}
            </p>
          </div>
        </div>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">
          {grant ? GRANT_STATUS_LABEL[grant.status] : "尚無匣"}
        </span>
      </div>

      {agency.lastDenial ? <DenialBanner reason={agency.lastDenial} /> : null}

      {agency.submittedAt && grantId === "G-甲" ? (
        <p className="text-[12px] text-neutral-600">匣 G-甲 已耗用。</p>
      ) : null}

      {leakedIncome ? (
        <p className="text-[13px] font-medium text-rose-700">錯誤：所得出現在此匣。</p>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-[13px] text-neutral-400">尚未收到匣內資料。</p>
      ) : (
        <dl className="space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="grid grid-cols-[6.5rem_1fr] gap-2 text-[13px] leading-5">
              <dt className="text-neutral-500">{FIELD_META[key as keyof typeof FIELD_META].label}</dt>
              <dd className="text-neutral-900">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">{children}</div>
    </article>
  );
}
