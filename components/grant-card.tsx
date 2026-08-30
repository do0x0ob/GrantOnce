"use client";

import { useState } from "react";
import { StatusChip } from "@/components/status-chip";
import { SENSITIVITY_CHIP } from "@/components/tone";
import { IdentityDot } from "@/components/identity-dot";
import { SURFACE } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { formatTime, type PrincipalView } from "@/lib/view";
import { cn } from "@/lib/utils";

type GrantView = PrincipalView["grants"][number];

const CHIP: Record<GrantView["status"], "stone" | "rose" | "mint" | "amber"> = {
  proposed: "amber",
  signed: "mint",
  redeemed: "mint",
  revoked: "stone",
  expired: "rose",
};

export function GrantCard({
  grant,
  busy,
  canSign,
  onSign,
  onRevoke,
}: {
  grant: GrantView;
  busy: boolean;
  canSign: boolean;
  onSign: () => void;
  onRevoke: () => void;
}) {
  const [showConsent, setShowConsent] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const blocked = grant.risk === "blocked";
  const elevated = grant.risk === "elevated";
  const signable = grant.status === "proposed" && !blocked && !grant.expired;

  return (
    <article className={cn(SURFACE, "space-y-3 p-4")}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <IdentityDot tone={grant.agencyId} />
            <p className="truncate text-[14px] leading-5 text-stone-800">{grant.programTitle}</p>
          </div>
          <p className="truncate text-[12px] leading-4 text-stone-400">
            {grant.id} · 受眾 {grant.agencyName}
          </p>
        </div>
        <StatusChip tone={blocked ? "rose" : elevated ? "amber" : CHIP[grant.status]}>
          {blocked || elevated ? grant.riskLabel : grant.statusLabel}
        </StatusChip>
      </header>

      <div className="space-y-1.5">
        <p className="text-[12px] leading-4 text-stone-400">機關會收到</p>
        <ul className="space-y-1">
          {grant.claims.map((claim) => (
            <li key={claim.claimId} className="flex items-baseline gap-2">
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-4",
                  SENSITIVITY_CHIP[claim.sensitivity],
                )}
              >
                {claim.shape}
              </span>
              <span className="text-[13px] leading-5 text-stone-600">{claim.label}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* The bindings that stop this being a bearer token. */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] leading-4 text-stone-400">
        <dt>綁定機關金鑰</dt>
        <dd className="truncate font-mono">cnf.jkt {grant.cnfJkt.slice(0, 16)}…</dd>
        <dt>一次性編號</dt>
        <dd className="truncate font-mono">{grant.jti}</dd>
        <dt>法定依據</dt>
        <dd className="space-y-0.5">
          {grant.legalBasis.map((basis) => (
            <div key={basis}>{basis}</div>
          ))}
        </dd>
        <dt>有效至</dt>
        <dd className={grant.expired ? "text-rose-500" : undefined}>
          {formatTime(grant.exp)}
          {grant.expired ? "（已逾期）" : ""}
        </dd>
        {grant.signature ? (
          <>
            <dt>簽章</dt>
            <dd className="truncate font-mono text-emerald-600">
              {grant.signMethod === "passkey" ? "生物辨識" : "軟體金鑰"} ·{" "}
              {grant.signature.slice(0, 12)}…
            </dd>
          </>
        ) : null}
      </dl>

      {blocked || elevated ? (
        <div className={cn("rounded-xl p-2.5", blocked ? "bg-rose-50" : "bg-amber-50")}>
          <p className={cn("text-[11px] leading-4", blocked ? "text-rose-500" : "text-amber-600")}>
            {blocked ? "提案階段即攔截" : "需要你額外確認"}
          </p>
          <ul className="mt-1 space-y-1">
            {grant.riskNotes.map((note) => (
              <li
                key={note}
                className={cn("text-[12px] leading-5", blocked ? "text-rose-700" : "text-amber-800")}
              >
                {note}
              </li>
            ))}
          </ul>
          {elevated && signable ? (
            <label className="mt-2 flex items-start gap-2 text-[12px] leading-5 text-amber-900">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5 accent-amber-600"
              />
              我了解上述風險，仍要簽署這一匣
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full px-2 text-[12px] text-stone-400 hover:text-stone-600"
          onClick={() => setShowConsent((v) => !v)}
        >
          {showConsent ? "收起簽署內容" : "看我簽的是什麼"}
        </Button>
        {signable ? (
          <Button
            size="sm"
            className="rounded-full"
            disabled={busy || !canSign || (elevated && !acknowledged)}
            onClick={onSign}
            title={
              !canSign
                ? "請先註冊簽章金鑰"
                : elevated && !acknowledged
                  ? "本匣風險升級，請先勾選確認"
                  : undefined
            }
          >
            以生物辨識簽署
          </Button>
        ) : null}
        {grant.status === "signed" || grant.status === "proposed" ? (
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-stone-400 hover:text-stone-600"
            disabled={busy}
            onClick={onRevoke}
          >
            撤銷
          </Button>
        ) : null}
      </div>

      {grant.expired && grant.status === "expired" ? (
        <p className="rounded-xl bg-rose-50 p-2.5 text-[12px] leading-5 text-rose-700">
          這一匣已逾效期。授權是短效的，過期就不能再簽也不能再兌現——請重新比對，簽一張新的。
        </p>
      ) : null}

      {showConsent ? (
        <div className="space-y-2 rounded-xl bg-stone-50 p-3">
          <p className="text-[11px] leading-4 text-stone-400">
            這段文字本身也被簽進去了。認證器的系統彈窗無法顯示簽署內容，所以把畫面上的字一併納入簽章範圍，
            事後才證明得了「當時看到的就是這段」。
          </p>
          <pre className="whitespace-pre-wrap text-[12px] leading-5 text-stone-600">
            {grant.displayText}
          </pre>
          <p className="font-mono text-[10px] leading-4 text-stone-400 break-all">
            摘要 {grant.digest}
          </p>
          <details>
            <summary className="cursor-pointer text-[11px] leading-4 text-stone-400">
              待簽的原始 bytes（cnf.jkt 就在裡面）
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto font-mono text-[10px] leading-4 break-all whitespace-pre-wrap text-stone-500">
              {grant.serialized}
            </pre>
          </details>
        </div>
      ) : null}
    </article>
  );
}
