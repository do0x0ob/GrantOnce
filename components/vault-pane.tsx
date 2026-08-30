"use client";

import { PageIntro } from "@/components/page-intro";
import { StatusChip } from "@/components/status-chip";
import { SURFACE } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate, type PrincipalView } from "@/lib/view";

/**
 * The vault is described, never valued.
 *
 * Nothing on this pane ships a raw record to the browser — the console can show
 * that 所得 and 健保 are held and that they never fed a credential, without
 * handing the numbers out to prove it.
 */
export function VaultPane({
  view,
  busy,
  onClock,
  onScan,
}: {
  view: PrincipalView;
  busy: boolean;
  onClock: (days: number) => void;
  onScan?: () => void;
}) {
  const derived = view.vaultCatalog.filter((e) => !e.neverLeft);
  const sealed = view.vaultCatalog.filter((e) => e.sealed);
  const idle = view.vaultCatalog.filter((e) => e.neverLeft && !e.sealed);
  const untouched = view.vaultCatalog.filter((e) => e.neverLeft).length;

  return (
    <div className="mx-auto w-full max-w-[40rem] space-y-12 px-6 py-10 sm:px-8">
      <PageIntro kicker="金庫與皮夾" title="什麼被用過，什麼沒有離開">
        金庫只在發證那一刻被讀取。原始值不會送到這台瀏覽器。
      </PageIntro>

      <section className={cn(SURFACE, "space-y-8 p-7 sm:p-9")}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[18px] leading-6 text-stone-800">假 MyData 金庫</p>
            <p className="text-[14px] leading-6 text-stone-400">
              「已派生述詞」代表這個欄位被用來算出一個是／否或級距，欄位本身沒有離開金庫。
            </p>
          </div>
          <StatusChip tone="stone">
            {untouched}／{view.vaultCatalog.length} 未曾離開
          </StatusChip>
        </div>

        {derived.length ? (
          <FieldGroup title="已派生述詞" tone="used" entries={derived} />
        ) : (
          <p className="text-[15px] leading-7 text-stone-400">還沒有任何欄位被用來發證。</p>
        )}

        <FieldGroup title="永不授權" tone="sealed" entries={sealed} />

        {idle.length ? (
          <details>
            <summary className="cursor-pointer text-[13px] leading-5 text-stone-400 hover:text-stone-600">
              其餘 {idle.length} 項未使用
            </summary>
            <div className="mt-4">
              <FieldGroup title="" tone="idle" entries={idle} />
            </div>
          </details>
        ) : null}
      </section>

      <section className={cn(SURFACE, "space-y-6 p-7 sm:p-9")}>
        <div className="space-y-1">
          <p className="text-[18px] leading-6 text-stone-800">皮夾憑證</p>
          <p className="text-[14px] leading-6 text-stone-400">
            親子關係憑證效期一年。出生證明要調 3–5 個工作天，這裡只付一次——之後每個申請都出示同一張。
          </p>
        </div>
        {view.wallet.length === 0 ? (
          <p className="text-[15px] leading-7 text-stone-400">
            還沒有憑證。第一次兌現時，發證機構會從金庫派生述詞並簽名，之後可重複出示。
          </p>
        ) : (
          <ul className="space-y-3">
            {view.wallet.map((cred) => (
              <li
                key={cred.id}
                className="flex items-baseline justify-between gap-4 rounded-2xl bg-stone-50 px-4 py-4"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-[15px] leading-6 text-stone-800">{cred.label}</p>
                  <p className="text-[13px] leading-5 text-stone-400">
                    {cred.issuerName}
                    {cred.signatureValid ? " · 簽章有效" : " · 簽章無效"}
                    {cred.audience
                      ? ` · 僅限 ${cred.audience === "jia" ? "甲" : "乙"}`
                      : " · 可跨機關重複出示"}
                    {` · 已出示 ${cred.presentedCount} 次`}
                    {` · ${cred.valid ? "有效至" : "已過期"} ${formatDate(cred.expiresAt)}`}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[16px] leading-6 text-stone-800">
                  {cred.value}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cn(SURFACE, "space-y-5 p-7 sm:p-9")}>
        <div className="space-y-2">
          <p className="text-[18px] leading-6 text-stone-800">動態授權：把時間往前推</p>
          <p className="text-[15px] leading-7 text-stone-500">
            幼兒滿 2 歲後就換一種補助。授權不會自動沿用——條件變了，得重新比對、重新簽一張新的匣。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "今天", days: 0 },
            { label: "+6 個月", days: 183 },
            { label: "+13 個月", days: 400 },
          ].map((option) => (
            <Button
              key={option.days}
              size="lg"
              variant={view.clockOffsetDays === option.days ? "default" : "secondary"}
              disabled={busy}
              onClick={() => onClock(option.days)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {onScan ? (
          <button
            type="button"
            disabled={busy}
            onClick={onScan}
            className="text-[13px] leading-5 text-stone-400 underline-offset-4 hover:text-stone-600 hover:underline disabled:opacity-40"
          >
            讓代理人主動檢查我的資格有沒有變
          </button>
        ) : null}
      </section>
    </div>
  );
}

function FieldGroup({
  title,
  tone,
  entries,
}: {
  title: string;
  tone: "used" | "sealed" | "idle";
  entries: PrincipalView["vaultCatalog"];
}) {
  const groups = new Map<string, PrincipalView["vaultCatalog"]>();
  for (const entry of entries) {
    groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  }

  return (
    <div className="space-y-3">
      {title ? (
        <p
          className={cn(
            "text-[12px] leading-4 tracking-[0.04em]",
            tone === "used" && "text-emerald-700",
            tone === "sealed" && "text-rose-600",
            tone === "idle" && "text-stone-400",
          )}
        >
          {title}
        </p>
      ) : null}
      <ul className="space-y-3">
        {[...groups.entries()].flatMap(([, items]) =>
          items.map((entry) => (
            <li key={entry.fieldId} className="flex items-baseline justify-between gap-4">
              <span className="text-[15px] leading-6 text-stone-700">{entry.label}</span>
              <span
                className={cn(
                  "shrink-0 text-[13px] leading-5",
                  tone === "used" && "text-emerald-700",
                  tone === "sealed" && "text-rose-600",
                  tone === "idle" && "text-stone-300",
                )}
              >
                {tone === "used" ? "已派生述詞" : tone === "sealed" ? "永不授權" : "未使用"}
              </span>
            </li>
          )),
        )}
      </ul>
    </div>
  );
}
