"use client";

import { useState } from "react";
import { StatusChip } from "@/components/status-chip";
import { GRANT_WASH, SURFACE } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { formatTime, type PrincipalView } from "@/lib/view";
import { cn } from "@/lib/utils";

type GrantView = PrincipalView["grants"][number];

/**
 * What each capsule is *not* carrying, in one line per purpose.
 *
 * Keyed rather than branched: as a two-way `=== "childcare-allowance"` check,
 * the third programme fell into the else and told the reader the energy
 * ministry was getting a usage band. A purpose hung on the registry desk has no
 * hand-written line, so it falls back to what is true of every capsule rather
 * than borrowing someone else's sentence.
 */
const MINIMISATION: Record<string, string> = {
  "childcare-allowance": "就這樣。姓名、地址、戶號、出生日期都不在這張匣裡。",
  "childcare-service-subsidy":
    "比育兒津貼還少一項——連「一年內遷入」都不需要。姓名、地址、出生日期一樣不在匣裡。",
  "aircon-subsidy": "經濟部拿到的是用電級距，加上一個只屬於它的帳戶代號——不是電號。",
};

const MINIMISATION_FALLBACK = "匣裡放的是述詞，不是原始欄位。上面列的就是機關會拿到的全部。";

const CHIP: Record<GrantView["status"], "stone" | "rose" | "mint" | "amber"> = {
  proposed: "amber",
  signed: "mint",
  redeemed: "mint",
  revoked: "stone",
  expired: "rose",
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
  const compact =
    !signable && !blocked && grant.status !== "expired" && !showConsent;

  if (compact) {
    return (
      <article className={cn(SURFACE, GRANT_WASH[grant.agencyId])}>
        <div className="flex items-center justify-between gap-4 p-6 sm:px-8">
          <div className="min-w-0 space-y-1">
            <h2 className="truncate text-[18px] font-medium leading-6 text-stone-900">
              {grant.programTitle}
            </h2>
            <p className="truncate text-[13px] leading-5 text-stone-400">{grant.agencyName}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusChip tone={CHIP[grant.status]}>{grant.statusLabel}</StatusChip>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full px-2 text-[13px] text-stone-400 hover:text-stone-700"
              onClick={() => setShowConsent(true)}
            >
              看我簽的是什麼
            </Button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className={cn(SURFACE, GRANT_WASH[grant.agencyId])}>
      <div className="space-y-8 p-7 sm:p-9">
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
            {MINIMISATION[grant.purpose] ?? MINIMISATION_FALLBACK}
          </p>
        </section>

        {blocked || elevated ? (
          <div className={cn("rounded-2xl px-4 py-3.5", blocked ? "bg-[var(--wash-risk)]" : "bg-[var(--wash-clay)]")}>
            <p className={cn("text-[13px] leading-5", blocked ? "text-[var(--orchid-deep)]" : "text-[var(--clay)]")}>
              {blocked ? "提案階段即攔截" : "需要你額外確認"}
            </p>
            <ul className="mt-2 space-y-1.5">
              {grant.riskNotes.map((note) => (
                <li
                  key={note}
                  className={cn("text-[14px] leading-6", blocked ? "text-[var(--orchid-deep)]" : "text-[var(--ink)]")}
                >
                  {note}
                </li>
              ))}
            </ul>
            {elevated && signable ? (
              <label className="mt-3 flex items-start gap-2.5 text-[14px] leading-6 text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-1 accent-[var(--clay)]"
                />
                我了解上述風險，仍要簽署這一匣
              </label>
            ) : null}
          </div>
        ) : null}

        {grant.expired && grant.status === "expired" ? (
          <p className="rounded-2xl bg-[var(--wash-risk)] px-4 py-3.5 text-[14px] leading-6 text-[var(--orchid-deep)]">
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
          <div className="space-y-4 rounded-2xl bg-[color-mix(in_oklab,white_45%,transparent)] px-5 py-4">
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
              <dt>個資依據</dt>
              <dd className="space-y-1">
                {grant.privacyBasis.map((basis) => (
                  <div key={basis}>{basis}</div>
                ))}
              </dd>
              {grant.programBasis.length ? (
                <>
                  <dt>作用法</dt>
                  <dd className="space-y-1">
                    {grant.programBasis.map((basis) => (
                      <div key={basis}>{basis}</div>
                    ))}
                  </dd>
                </>
              ) : null}
              <dt>有效至</dt>
              <dd className={grant.expired ? "text-[var(--orchid-deep)]" : undefined}>
                {formatTime(grant.exp)}
                {grant.expired ? "（已逾期）" : ""}
              </dd>
              {grant.signature ? (
                <>
                  <dt>簽章</dt>
                  <dd className="truncate font-mono text-[var(--sage)]">
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
