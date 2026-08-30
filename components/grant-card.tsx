"use client";

import { useState } from "react";
import { StatusChip } from "@/components/status-chip";
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

const ACCENT: Record<string, string> = {
  jia: "bg-[#7BA88A]",
  yi: "bg-[#D4A35A]",
};

function isChoiceBand(shape: string) {
  return shape.split("／").length >= 3;
}

function ClaimRow({ claim }: { claim: GrantView["claims"][number] }) {
  const options = isChoiceBand(claim.shape)
    ? claim.shape.split("／").map((part) => part.trim()).filter(Boolean)
    : null;

  return (
    <li className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[15px] leading-6 text-stone-800">{claim.label}</p>
        {!options ? (
          <p className="shrink-0 text-[13px] leading-5 text-stone-400">{claim.shape}</p>
        ) : null}
      </div>
      {options ? (
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <span
              key={option}
              className="rounded-xl border border-dashed border-stone-200 px-3 py-1.5 text-[13px] leading-5 text-stone-400"
            >
              {option}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}

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
  const childcare = grant.purpose === "childcare-allowance";

  return (
    <article className={cn(SURFACE, "relative overflow-hidden")}>
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-1", ACCENT[grant.agencyId] ?? "bg-stone-300")}
      />

      <div className="space-y-8 p-7 pl-8 sm:p-9 sm:pl-10">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <h2 className="text-[22px] font-medium leading-7 tracking-tight text-stone-900">
              {grant.programTitle}
            </h2>
            <p className="text-[14px] leading-5 text-stone-400">{grant.agencyName}</p>
          </div>
          <StatusChip tone={blocked ? "rose" : elevated ? "amber" : CHIP[grant.status]}>
            {blocked || elevated ? grant.riskLabel : grant.statusLabel}
          </StatusChip>
        </header>

        <section className="space-y-5">
          <p className="text-[13px] leading-5 tracking-[0.04em] text-stone-400">機關會收到</p>
          <ul className="space-y-5">
            {grant.claims.map((claim) => (
              <ClaimRow key={claim.claimId} claim={claim} />
            ))}
          </ul>
          <p className="text-[14px] leading-6 text-stone-400">
            {childcare
              ? "就這樣。姓名、地址、戶號、出生日期都不在這張匣裡。"
              : "經濟部拿到的是用電級距，加上一個只屬於它的帳戶代號——不是電號。"}
          </p>
        </section>

        {blocked || elevated ? (
          <div className={cn("rounded-2xl px-4 py-3.5", blocked ? "bg-rose-50" : "bg-amber-50")}>
            <p className={cn("text-[13px] leading-5", blocked ? "text-rose-600" : "text-amber-700")}>
              {blocked ? "提案階段即攔截" : "需要你額外確認"}
            </p>
            <ul className="mt-2 space-y-1.5">
              {grant.riskNotes.map((note) => (
                <li
                  key={note}
                  className={cn("text-[14px] leading-6", blocked ? "text-rose-800" : "text-amber-900")}
                >
                  {note}
                </li>
              ))}
            </ul>
            {elevated && signable ? (
              <label className="mt-3 flex items-start gap-2.5 text-[14px] leading-6 text-amber-950">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-1 accent-amber-700"
                />
                我了解上述風險，仍要簽署這一匣
              </label>
            ) : null}
          </div>
        ) : null}

        {grant.expired && grant.status === "expired" ? (
          <p className="rounded-2xl bg-rose-50 px-4 py-3.5 text-[14px] leading-6 text-rose-800">
            這一匣已逾效期。授權是短效的，過期就不能再簽也不能再兌現——請重新比對，簽一張新的。
          </p>
        ) : null}

        <div className="space-y-3">
          {signable ? (
            <Button
              size="xl"
              className="w-full"
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full px-2 text-[13px] text-stone-400 hover:text-stone-700"
              onClick={() => setShowConsent((v) => !v)}
            >
              {showConsent ? "收起簽署內容" : "看我簽的是什麼"}
            </Button>
            {grant.status === "signed" || grant.status === "proposed" ? (
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full text-[13px] text-stone-400 hover:text-stone-700"
                disabled={busy}
                onClick={onRevoke}
              >
                撤銷
              </Button>
            ) : null}
          </div>
        </div>

        {showConsent ? (
          <div className="space-y-4 rounded-2xl bg-stone-50/80 px-5 py-4">
            <p className="text-[13px] leading-6 text-stone-500">
              這段文字本身也被簽進去了。認證器的系統彈窗無法顯示簽署內容，所以把畫面上的字一併納入簽章範圍，
              事後才證明得了「當時看到的就是這段」。
            </p>
            <pre className="whitespace-pre-wrap text-[14px] leading-6 text-stone-700">
              {grant.displayText}
            </pre>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12px] leading-5 text-stone-400">
              <dt>綁定機關金鑰</dt>
              <dd className="truncate font-mono">cnf.jkt {grant.cnfJkt.slice(0, 16)}…</dd>
              <dt>一次性編號</dt>
              <dd className="truncate font-mono">{grant.jti}</dd>
              <dt>法定依據</dt>
              <dd className="space-y-1">
                {grant.legalBasis.map((basis) => (
                  <div key={basis}>{basis}</div>
                ))}
              </dd>
              <dt>有效至</dt>
              <dd className={grant.expired ? "text-rose-600" : undefined}>
                {formatTime(grant.exp)}
                {grant.expired ? "（已逾期）" : ""}
              </dd>
              {grant.signature ? (
                <>
                  <dt>簽章</dt>
                  <dd className="truncate font-mono text-emerald-700">
                    {grant.signMethod === "passkey" ? "生物辨識" : "軟體金鑰"} ·{" "}
                    {grant.signature.slice(0, 12)}…
                  </dd>
                </>
              ) : null}
            </dl>
            <p className="font-mono text-[11px] leading-5 break-all text-stone-400">
              摘要 {grant.digest}
            </p>
            <details>
              <summary className="cursor-pointer text-[13px] leading-5 text-stone-400">
                待簽的原始 bytes（cnf.jkt 就在裡面）
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto font-mono text-[11px] leading-5 break-all whitespace-pre-wrap text-stone-500">
                {grant.serialized}
              </pre>
            </details>
          </div>
        ) : null}
      </div>
    </article>
  );
}
