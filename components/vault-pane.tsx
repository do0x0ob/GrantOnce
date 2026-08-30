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
}: {
  view: PrincipalView;
  busy: boolean;
  onClock: (days: number) => void;
}) {
  const groups = new Map<string, PrincipalView["vaultCatalog"]>();
  for (const entry of view.vaultCatalog) {
    groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  }
  const untouched = view.vaultCatalog.filter((e) => e.neverLeft).length;

  return (
    <div className="mx-auto w-full max-w-[40rem] space-y-12 px-6 py-10 sm:px-8">
      <PageIntro kicker="金庫與皮夾" title="什麼被用過，什麼沒有離開">
        金庫只在「發證」那一刻被讀取。畫面不顯示任何原始值，伺服器也不會把它們送到瀏覽器。
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
        {[...groups.entries()].map(([group, entries]) => (
          <div key={group} className="space-y-3">
            <p className="text-[12px] leading-4 tracking-[0.04em] text-stone-400">{group}</p>
            <ul className="space-y-3">
              {entries.map((entry) => (
                <li key={entry.fieldId} className="flex items-baseline justify-between gap-4">
                  <span className="text-[15px] leading-6 text-stone-700">{entry.label}</span>
                  {entry.neverLeft ? (
                    <span
                      className={cn(
                        "shrink-0 text-[13px] leading-5",
                        entry.sealed ? "text-rose-600" : "text-stone-300",
                      )}
                    >
                      {entry.sealed ? "永不授權" : "未使用"}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[13px] leading-5 text-emerald-700">
                      已派生述詞
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
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
          <ul className="space-y-4">
            {view.wallet.map((cred) => (
              <li key={cred.id} className="space-y-2 rounded-2xl bg-stone-50 px-4 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] leading-6 text-stone-800">{cred.label}</span>
                  <span className="font-mono text-[14px] leading-6 text-stone-800">
                    {cred.value}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-stone-400">
                  <span>{cred.issuerName} 簽發</span>
                  {cred.signatureValid ? (
                    <span className="text-emerald-700">簽章有效</span>
                  ) : (
                    <span className="text-rose-600">簽章無效</span>
                  )}
                  {cred.audience ? (
                    <span className="text-sky-700">
                      僅限 {cred.audience === "jia" ? "甲" : "乙"}
                    </span>
                  ) : (
                    <span>可跨機關重複出示</span>
                  )}
                  <span>已出示 {cred.presentedCount} 次</span>
                  <span>
                    {cred.valid ? "有效至" : "已過期"} {formatDate(cred.expiresAt)}
                  </span>
                </div>
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
      </section>
    </div>
  );
}
