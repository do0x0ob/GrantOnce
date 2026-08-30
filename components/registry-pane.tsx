"use client";

import { useMemo, useState } from "react";
import { IdentityDot } from "@/components/identity-dot";
import { PageIntro } from "@/components/page-intro";
import { StatusChip } from "@/components/status-chip";
import { GRANT_WASH, SURFACE } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Demo } from "@/hooks/use-demo";

const DEFAULT_BASIS = [
  "個人資料保護法 §15 第 1 款：執行法定職務必要範圍內蒐集、處理",
  "個人資料保護法 §16 本文：於執行法定職務必要範圍內利用，並與蒐集之特定目的相符",
  "個人資料保護法 §5：不得逾越特定目的之必要範圍",
].join("\n");
const DEFAULT_RETENTION = "案件辦理期間及依法應保存的期限；期滿後刪除或停止利用。";
const DEFAULT_AREA = "中華民國境內";
const DEFAULT_METHOD = "由資料來源機關簽發資格憑證，直接交付本服務機關進行線上審核。";
const DEFAULT_DECLINE = "不提供則無法由本流程自動查驗資格，仍可改走人工申請。";

const FIELD =
  "w-full rounded-[24px] border-0 bg-white px-5 py-3 text-[15px] leading-6 text-stone-800 shadow-[0_1px_0_rgba(26,24,20,0.04)] outline-none placeholder:text-stone-400 focus-visible:ring-2 focus-visible:ring-stone-300/70 disabled:opacity-50";

export function RegistryPane({ demo }: { demo: Demo }) {
  const registry = demo.view.registry;
  const [id, setId] = useState("");
  const [title, setTitle] = useState("");
  const [agency, setAgency] = useState<"jia" | "yi">("jia");
  const [privacyBasis, setPrivacyBasis] = useState(DEFAULT_BASIS);
  const [necessity, setNecessity] = useState("");
  const [retentionPolicy, setRetentionPolicy] = useState(DEFAULT_RETENTION);
  const [processingArea, setProcessingArea] = useState(DEFAULT_AREA);
  const [processingMethod, setProcessingMethod] = useState(DEFAULT_METHOD);
  const [declineEffect, setDeclineEffect] = useState(DEFAULT_DECLINE);
  const [ttl, setTtl] = useState("600");
  const [claims, setClaims] = useState<string[]>([]);

  const hangable = useMemo(
    () =>
      registry.availableClaims.filter(
        (claim) => claim.sensitivity === "predicate" || claim.sensitivity === "pseudonym",
      ),
    [registry.availableClaims],
  );

  function load(purpose: (typeof registry.purposes)[number]) {
    setId(purpose.id);
    setTitle(purpose.title);
    setAgency(purpose.agency);
    setPrivacyBasis(purpose.privacyBasis.join("\n"));
    setNecessity(purpose.necessity);
    setRetentionPolicy(purpose.retentionPolicy);
    setProcessingArea(purpose.processingArea);
    setProcessingMethod(purpose.processingMethod);
    setDeclineEffect(purpose.declineEffect);
    setTtl(String(purpose.maxTtlSeconds));
    setClaims([...purpose.allowedClaims]);
  }

  return (
    <div className="mx-auto w-full max-w-[40rem] space-y-10 px-6 py-10 sm:px-8">
      <PageIntro kicker="服務／請求機關維護" title="登記台">
        登記服務目的、最小述詞與個資告知事項。資料來源已上線的述詞才能勾，模型不能新增欄位。
      </PageIntro>

      <section className="space-y-4">
        {registry.purposes.map((purpose) => (
          <article key={purpose.id} className={cn(SURFACE, GRANT_WASH[purpose.agency], "space-y-4 p-7")}>
            <header className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <IdentityDot tone={purpose.agency} />
                  <p className="text-[17px] leading-6 text-stone-800">{purpose.title}</p>
                </div>
                <p className="font-mono text-[12px] leading-5 text-stone-400">{purpose.id}</p>
              </div>
              <StatusChip tone={purpose.builtin ? "stone" : "mint"}>
                {purpose.builtin ? (purpose.overridden ? "已改" : "內建") : "機關掛上"}
              </StatusChip>
            </header>
            <p className="text-[14px] leading-6 text-stone-600">{purpose.agencyName}</p>
            <p className="text-[14px] leading-6 text-stone-500">
              資料來源：{purpose.dataSources.map((source) => source.name).join("、")}
            </p>
            <p className="text-[14px] leading-6 text-stone-500">述詞：{purpose.allowedClaims.join("、")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                disabled={demo.busy}
                onClick={() => load(purpose)}
              >
                載入編輯
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full text-[var(--orchid-deep)] hover:bg-[var(--wash-risk)] hover:text-[var(--orchid-deep)]"
                disabled={demo.busy}
                onClick={() => void demo.retirePurpose(purpose.id)}
              >
                下架
              </Button>
            </div>
          </article>
        ))}
      </section>

      {registry.retiredPurposes.length > 0 ? (
        <p className="text-[14px] leading-6 text-stone-400">
          已下架：{registry.retiredPurposes.join("、")}。重設後回到內建三筆。
        </p>
      ) : null}

      <form
        className={cn(SURFACE, "space-y-5 p-7 sm:p-9")}
        onSubmit={(event) => {
          event.preventDefault();
          void demo.upsertPurpose({
            id,
            title,
            agency,
            privacyBasis: privacyBasis.split("\n"),
            allowedClaims: claims,
            maxTtlSeconds: Number(ttl),
            necessity,
            retentionPolicy,
            processingArea,
            processingMethod,
            declineEffect,
          });
        }}
      >
        <p className="text-[15px] leading-6 text-stone-700">掛上／改一筆目的</p>
        <Input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="目的 ID，例如 flood-relief"
          disabled={demo.busy}
        />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="名稱，例如 水災災害救助"
          disabled={demo.busy}
        />
        <div className="flex gap-1 rounded-full bg-white/70 p-1 shadow-[0_1px_0_rgba(26,24,20,0.04)]">
          {(
            [
              { id: "jia", label: "甲｜社會局" },
              { id: "yi", label: "乙｜能源／台電" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setAgency(item.id)}
              className={cn(
                "flex-1 rounded-full px-4 py-2.5 text-[14px] leading-5 transition-colors",
                agency === item.id
                  ? "bg-[var(--ink)] text-[var(--primary-foreground)]"
                  : "text-stone-500 hover:text-stone-800",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="block space-y-2">
          <span className="text-[13px] leading-5 text-stone-400">個資依據（每行一條）</span>
          <textarea
            value={privacyBasis}
            onChange={(e) => setPrivacyBasis(e.target.value)}
            rows={5}
            disabled={demo.busy}
            className={FIELD}
          />
        </label>
        <textarea
          value={necessity}
          onChange={(e) => setNecessity(e.target.value)}
          rows={3}
          placeholder="為什麼這些述詞就夠、為什麼不要更多。"
          disabled={demo.busy}
          className={FIELD}
        />
        <textarea
          value={retentionPolicy}
          onChange={(e) => setRetentionPolicy(e.target.value)}
          rows={2}
          placeholder="資料保存期間，以及期限屆滿後如何處理。"
          disabled={demo.busy}
          className={FIELD}
        />
        <Input
          value={processingArea}
          onChange={(e) => setProcessingArea(e.target.value)}
          placeholder="資料利用地區"
          disabled={demo.busy}
        />
        <textarea
          value={processingMethod}
          onChange={(e) => setProcessingMethod(e.target.value)}
          rows={2}
          placeholder="資料來源如何交付、服務機關如何利用。"
          disabled={demo.busy}
          className={FIELD}
        />
        <textarea
          value={declineEffect}
          onChange={(e) => setDeclineEffect(e.target.value)}
          rows={2}
          placeholder="不提供資料對使用者權益的影響。"
          disabled={demo.busy}
          className={FIELD}
        />
        <Input value={ttl} onChange={(e) => setTtl(e.target.value)} placeholder="效期秒數" disabled={demo.busy} />
        <fieldset className="space-y-2">
          <legend className="text-[13px] leading-5 text-stone-400">已上線述詞（不能自己加 ID）</legend>
          {hangable.map((claim) => (
            <label key={claim.id} className="flex items-center gap-3 text-[15px] leading-6 text-stone-600">
              <input
                type="checkbox"
                checked={claims.includes(claim.id)}
                disabled={demo.busy}
                onChange={() =>
                  setClaims((current) =>
                    current.includes(claim.id) ? current.filter((item) => item !== claim.id) : [...current, claim.id],
                  )
                }
              />
              <span>
                {claim.label}
                <span className="ml-2 font-mono text-[12px] text-stone-400">{claim.id}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-[14px] leading-6 text-stone-400">
          水災若要真的能發票，缺的是發證端的 disaster.* adapter，不是在這裡打一個新 ID。
        </p>
        {demo.error ? (
          <p role="alert" className="text-[14px] leading-6 text-[var(--orchid-deep)]">
            {demo.error}
          </p>
        ) : null}
        <Button
          type="submit"
          size="lg"
          disabled={
            demo.busy ||
            !id.trim() ||
            !title.trim() ||
            claims.length === 0 ||
            necessity.trim().length < 8 ||
            retentionPolicy.trim().length < 8 ||
            processingMethod.trim().length < 8 ||
            declineEffect.trim().length < 8
          }
        >
          寫入登記表
        </Button>
      </form>

      <section className={cn(SURFACE, "space-y-5 p-7")}>
        <p className="text-[15px] leading-6 text-stone-700">發證端已上線</p>
        <div className="space-y-5">
          {registry.issuers.map((issuer) => (
            <div key={issuer.issuer}>
              <p className="text-[15px] leading-6 text-stone-600">{issuer.issuerName}</p>
              <ul className="mt-1 space-y-0.5">
                {issuer.claims.map((claim) => (
                  <li key={claim.id} className="font-mono text-[12px] leading-5 text-stone-400">
                    {claim.id} · {claim.label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
