"use client";

import type { ReactNode } from "react";
import { AuditTimeline } from "@/components/audit-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FIELD_META, HOUSEHOLD_FIELDS, JIA_FIELDS } from "@/lib/fields";
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
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header>
        <p className="text-[11px] tracking-[0.2em] text-stone-500">機關收件匣＋稽核</p>
        <h2 className="font-serif text-xl text-stone-900">甲與乙看到不同的匣</h2>
        <p className="text-xs leading-5 text-stone-600">
          越權請求關閉。送件後授權立即耗用。
        </p>
      </header>

      <div className="grid min-h-0 gap-2 md:grid-cols-2">
        <AgencyCard
          title="甲｜新北市社會局"
          program="育兒津貼"
          grantId="G-甲"
          state={state}
          envelope={state.envelopes["G-甲"]}
        >
          <Button
            size="sm"
            disabled={busy || !state.envelopes["G-甲"].fetchedAt || Boolean(state.agencies.jia.submittedAt)}
            onClick={() => void onSubmitJia()}
          >
            送出申請
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !state.agencies.jia.submittedAt}
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
            disabled={busy || state.grants.find((g) => g.id === "G-乙")?.status !== "active"}
            onClick={() => void onOverscope()}
          >
            索取戶籍謄本
          </Button>
        </AgencyCard>
      </div>

      <section className="min-h-0 flex-1 rounded-xl border border-stone-300/80 bg-white/80 p-3">
        <h3 className="mb-2 text-sm font-medium">稽核時間線</h3>
        <AuditTimeline entries={state.audit} />
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
    <article className="flex flex-col gap-2 rounded-xl border border-stone-300/80 bg-[#fbf7ee] p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-serif text-base text-stone-900">{title}</p>
          <p className="text-[11px] text-stone-500">
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

      {agency.lastDenial ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-2 py-2 text-xs leading-5 text-red-900">
          <p className="font-medium">403 拒絕</p>
          <p>{agency.lastDenial}</p>
        </div>
      ) : null}

      {agency.submittedAt ? (
        <p className="rounded-md border border-stone-400 bg-stone-100 px-2 py-1 text-[11px] text-stone-700">
          已收件（演示）。匣 {grantId} 已耗用。
        </p>
      ) : null}

      {leakedIncome ? (
        <p className="text-xs text-red-800">錯誤：所得不該出現在此匣。</p>
      ) : null}

      {entries.length === 0 ? (
        <p className="text-xs text-stone-500">尚未收到授權匣內的資料。</p>
      ) : (
        <dl className="space-y-1.5">
          {entries.map(([key, value]) => (
            <div key={key} className="grid grid-cols-[7.5rem_1fr] gap-2 text-xs">
              <dt className="text-stone-500">{FIELD_META[key as keyof typeof FIELD_META].label}</dt>
              <dd className="font-medium text-stone-800">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">{children}</div>

      {grantId === "G-乙" ? (
        <p className="text-[11px] text-stone-500">
          「索取戶籍謄本」會用 `Bearer Grant G-yi`（匣 G-乙）去要 {HOUSEHOLD_FIELDS.length} 個戶籍欄，預期 403。
        </p>
      ) : (
        <p className="text-[11px] text-stone-500">
          送件後再按「重放擷取」，會用已耗用的匣重要 {JIA_FIELDS.length} 欄，預期 403。
        </p>
      )}
    </article>
  );
}
