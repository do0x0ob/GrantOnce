"use client";

import type { ReactNode } from "react";
import { AuditTimeline } from "@/components/audit-timeline";
import { DenialBanner } from "@/components/denial-banner";
import { Badge } from "@/components/ui/badge";
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
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="shrink-0 border-b border-stone-300/70 pb-2">
        <p className="text-[11px] text-stone-500">機關收件匣 · 稽核</p>
        <h2 className="font-serif text-xl leading-7 text-stone-900">甲與乙各看一匣</h2>
      </header>

      <div className="grid shrink-0 gap-3 md:grid-cols-2">
        <AgencyCard
          title="甲｜新北市社會局"
          program="育兒津貼"
          grantId="G-甲"
          state={state}
          envelope={state.envelopes["G-甲"]}
        >
          <Button
            size="sm"
            disabled={busy || !jiaFetched || jiaSubmitted}
            onClick={() => void onSubmitJia()}
          >
            送出申請
          </Button>
          <Button
            size="sm"
            variant={jiaSubmitted ? "destructive" : "outline"}
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
          state={state}
          envelope={state.envelopes["G-乙"]}
        >
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || !yiActive}
            onClick={() => void onOverscope()}
          >
            索取戶籍謄本
          </Button>
        </AgencyCard>
      </div>

      <section className="min-h-0 flex-1 overflow-auto">
        <h3 className="mb-2 text-[13px] font-medium text-stone-800">稽核時間線</h3>
        <AuditTimeline entries={state.audit} state={state} />
      </section>
    </div>
  );
}

function AgencyCard({
  title,
  program,
  grantId,
  state,
  envelope,
  children,
}: {
  title: string;
  program: string;
  grantId: GrantId;
  state: DemoState;
  envelope: Envelope;
  children: ReactNode;
}) {
  const grant = state.grants.find((g) => g.id === grantId);
  const agency = grantId === "G-甲" ? state.agencies.jia : state.agencies.yi;
  const entries = Object.entries(envelope.fields);
  const leakedIncome = envelopeHasIncome(state, grantId);

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-stone-300/80 bg-[#fbf8f1] p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-serif text-[15px] leading-6 text-stone-900">{title}</p>
          <p className="text-[12px] text-stone-500">
            {program} · {grantId}
          </p>
        </div>
        {grant ? (
          <Badge variant="outline" className="rounded-md">
            {GRANT_STATUS_LABEL[grant.status]}
          </Badge>
        ) : (
          <Badge variant="secondary" className="rounded-md">
            尚無匣
          </Badge>
        )}
      </div>

      {agency.lastDenial ? <DenialBanner reason={agency.lastDenial} /> : null}

      {agency.submittedAt && grantId === "G-甲" ? (
        <p className="text-[12px] font-medium text-stone-700">匣 G-甲 已耗用。</p>
      ) : null}

      {leakedIncome ? (
        <p className="text-[13px] font-medium text-red-800">錯誤：所得出現在此匣。</p>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-[13px] text-stone-500">尚未收到匣內資料。</p>
      ) : (
        <dl className="space-y-1">
          {entries.map(([key, value]) => (
            <div key={key} className="grid grid-cols-[6.5rem_1fr] gap-2 text-[13px] leading-5">
              <dt className="text-stone-500">{FIELD_META[key as keyof typeof FIELD_META].label}</dt>
              <dd className="font-medium text-stone-900">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">{children}</div>
    </article>
  );
}
