"use client";

import type { ReactNode } from "react";
import { AuditTimeline } from "@/components/audit-timeline";
import { DenialBanner, StatusChip } from "@/components/denial-banner";
import { IdentityDot } from "@/components/identity-dot";
import { ProtocolInspector } from "@/components/protocol-inspector";
import { SURFACE } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { FIELD_META } from "@/lib/fields";
import type { DemoState, Envelope, FieldId, GrantId } from "@/lib/types";
import { envelopeHasIncome, GRANT_STATUS_LABEL, groupedFields, shortHash } from "@/lib/view";

export function AgencyPane({
  state,
  busy,
  contrast,
  fatFields,
  onOverscopeYi,
  onSlotAsTicketYi,
  onOverscopeJia,
  onSlotAsTicketJia,
  onSubmitJia,
  onReplayJia,
}: {
  state: DemoState;
  busy: boolean;
  contrast: boolean;
  fatFields: Partial<Record<FieldId, string>>;
  onOverscopeYi: () => Promise<unknown>;
  onSlotAsTicketYi: () => Promise<unknown>;
  onOverscopeJia: () => Promise<unknown>;
  onSlotAsTicketJia: () => Promise<unknown>;
  onSubmitJia: () => Promise<unknown>;
  onReplayJia: () => Promise<unknown>;
}) {
  const jia = state.grants.find((g) => g.id === "G-甲");
  const yi = state.grants.find((g) => g.id === "G-乙");
  const jiaActive = jia?.status === "active";
  const yiActive = yi?.status === "active";
  const jiaSubmitted = Boolean(state.agencies.jia.submittedAt);
  const jiaFetched = Boolean(state.envelopes["G-甲"].fetchedAt);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="grid shrink-0 grid-cols-2 gap-3">
        <AgencyCard
          title="甲｜新北市社會局"
          grantId="G-甲"
          tone="jia"
          state={state}
          envelope={state.envelopes["G-甲"]}
          contrast={contrast}
          fatFields={fatFields}
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
            variant="ghost"
            className="rounded-full text-stone-400"
            disabled={busy || !jiaSubmitted}
            onClick={() => void onReplayJia()}
          >
            重放擷取
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-stone-400"
            disabled={busy || !jiaActive}
            onClick={() => void onOverscopeJia()}
          >
            索取用電量
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-stone-400"
            disabled={busy || !yi}
            onClick={() => void onSlotAsTicketJia()}
          >
            用匣號 G-乙
          </Button>
        </AgencyCard>

        <AgencyCard
          title="乙｜經濟部 × 台電"
          grantId="G-乙"
          tone="yi"
          state={state}
          envelope={state.envelopes["G-乙"]}
          contrast={contrast}
          fatFields={fatFields}
        >
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-stone-400"
            disabled={busy || !yiActive}
            onClick={() => void onOverscopeYi()}
          >
            索取戶籍謄本
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-stone-400"
            disabled={busy || !jia}
            onClick={() => void onSlotAsTicketYi()}
          >
            用匣號 G-甲
          </Button>
        </AgencyCard>
      </div>

      <ProtocolInspector event={state.lastProtocol} />

      <section className={`${SURFACE} min-h-0 flex-1 overflow-auto px-5 py-4`}>
        <p className="mb-3 text-[13px] leading-5 text-stone-400">稽核</p>
        <AuditTimeline entries={state.audit} state={state} />
      </section>
    </div>
  );
}

function AgencyCard({
  title,
  grantId,
  tone,
  state,
  envelope,
  contrast,
  fatFields,
  children,
}: {
  title: string;
  grantId: GrantId;
  tone: "jia" | "yi";
  state: DemoState;
  envelope: Envelope;
  contrast: boolean;
  fatFields: Partial<Record<FieldId, string>>;
  children: ReactNode;
}) {
  const grant = state.grants.find((g) => g.id === grantId);
  const agency = grantId === "G-甲" ? state.agencies.jia : state.agencies.yi;
  const leakedIncome = !contrast && envelopeHasIncome(state, grantId);
  const idColor = tone === "jia" ? "text-emerald-700" : "text-amber-700";
  const chipTone =
    grant?.status === "consumed" || grant?.status === "revoked"
      ? "stone"
      : grant?.status === "active"
        ? "mint"
        : "amber";

  return (
    <article className={`${SURFACE} flex flex-col gap-2.5 px-4 py-4`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <IdentityDot tone={tone} />
          <div>
            <p className={`text-[14px] leading-5 ${idColor}`}>{grantId}</p>
            <p className="text-[12px] leading-5 text-stone-400">{title}</p>
          </div>
        </div>
        <StatusChip tone={grant ? chipTone : "stone"}>
          {contrast ? "fields:*" : grant ? GRANT_STATUS_LABEL[grant.status] : "尚無匣"}
        </StatusChip>
      </div>

      {agency.lastDenial && !contrast ? <DenialBanner reason={agency.lastDenial} /> : null}

      {leakedIncome ? (
        <p className="text-[13px] leading-5 text-rose-600">錯誤：所得出現在此匣。</p>
      ) : null}

      {contrast ? (
        <FatFields fields={fatFields} />
      ) : envelope.receipt ? (
        <p className="text-[13px] leading-6 text-stone-600">
          已送件 · {envelope.receipt.fieldIds.length} 欄雜湊 · {shortHash(envelope.receipt.hash)} ·
          無法再讀
        </p>
      ) : Object.keys(envelope.fields).length === 0 ? (
        <p className="text-[13px] leading-6 text-stone-400">尚未收到匣內資料。</p>
      ) : (
        <FieldLines fields={envelope.fields} />
      )}

      {contrast ? null : <div className="mt-auto flex flex-wrap gap-1 pt-1">{children}</div>}
    </article>
  );
}

function FieldLines({ fields }: { fields: Partial<Record<FieldId, string>> }) {
  const ids = Object.keys(fields) as FieldId[];
  return (
    <div className="space-y-1">
      {groupedFields(ids).map(([group, groupIds]) => (
        <p key={group} className="text-[13px] leading-6 text-stone-600">
          <span className="text-stone-400">{group} </span>
          {groupIds.map((id) => `${FIELD_META[id].label} ${fields[id]}`).join(" · ")}
        </p>
      ))}
    </div>
  );
}

function FatFields({ fields }: { fields: Partial<Record<FieldId, string>> }) {
  const ids = Object.keys(fields) as FieldId[];
  return (
    <div className="space-y-1">
      <p className="text-[12px] leading-5 text-rose-600">錯的解法：每個機關都看到全部</p>
      {groupedFields(ids).map(([group, groupIds]) => (
        <p
          key={group}
          className={`text-[13px] leading-6 ${group === "所得" ? "text-rose-700" : "text-stone-600"}`}
        >
          <span className="text-stone-400">{group} </span>
          {groupIds.map((id) => `${FIELD_META[id].label} ${fields[id]}`).join(" · ")}
        </p>
      ))}
    </div>
  );
}
