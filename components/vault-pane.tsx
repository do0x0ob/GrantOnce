"use client";

import { StatusChip } from "@/components/status-chip";
import { SURFACE } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PrincipalView } from "@/lib/view";

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
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0 space-y-1">
        <p className="text-[14px] leading-5 text-stone-800">金庫與皮夾</p>
        <p className="text-[12px] leading-5 text-stone-400">
          金庫只在「發證」那一刻被讀取。畫面不顯示任何原始值，伺服器也不會把它們送到瀏覽器。
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <section className={cn(SURFACE, "space-y-3 p-4")}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] leading-5 text-stone-700">假 MyData 金庫</p>
            <StatusChip tone="stone">
              {untouched}／{view.vaultCatalog.length} 未曾離開
            </StatusChip>
          </div>
          {[...groups.entries()].map(([group, entries]) => (
            <div key={group} className="space-y-1">
              <p className="text-[11px] leading-4 text-stone-400">{group}</p>
              <ul className="space-y-0.5">
                {entries.map((entry) => (
                  <li key={entry.fieldId} className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] leading-5 text-stone-600">{entry.label}</span>
                    {entry.neverLeft ? (
                      <span
                        className={cn(
                          "shrink-0 text-[11px] leading-4",
                          entry.sealed ? "text-rose-500" : "text-stone-300",
                        )}
                      >
                        {entry.sealed ? "永不授權" : "未使用"}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] leading-4 text-emerald-600">
                        已派生述詞
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="text-[11px] leading-4 text-stone-400">
            「已派生述詞」代表這個欄位被用來算出一個是／否或級距，欄位本身沒有離開金庫。
          </p>
        </section>

        <section className={cn(SURFACE, "space-y-3 p-4")}>
          <p className="text-[13px] leading-5 text-stone-700">皮夾憑證</p>
          {view.wallet.length === 0 ? (
            <p className="text-[12px] leading-5 text-stone-400">
              還沒有憑證。第一次兌現時，發證機構會從金庫派生述詞並簽名，之後可重複出示。
            </p>
          ) : (
            <ul className="space-y-2">
              {view.wallet.map((cred) => (
                <li key={cred.id} className="space-y-1 rounded-xl bg-stone-50 p-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] leading-5 text-stone-700">{cred.label}</span>
                    <span className="font-mono text-[12px] leading-5 text-stone-800">
                      {cred.value}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-stone-400">
                    <span>{cred.issuerName} 簽發</span>
                    {cred.signatureValid ? (
                      <span className="text-emerald-600">簽章有效</span>
                    ) : (
                      <span className="text-rose-500">簽章無效</span>
                    )}
                    {cred.audience ? (
                      <span className="text-sky-600">
                        僅限 {cred.audience === "jia" ? "甲" : "乙"}
                      </span>
                    ) : (
                      <span>可跨機關重複出示</span>
                    )}
                    <span>已出示 {cred.presentedCount} 次</span>
                    <span>
                      {cred.valid ? "有效至" : "已過期"}{" "}
                      {new Date(cred.expiresAt).toLocaleDateString("zh-TW")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] leading-4 text-stone-400">
            親子關係憑證效期一年。出生證明要調 3–5 個工作天，這裡只付一次——之後每個申請都出示同一張。
          </p>
        </section>

        <section className={cn(SURFACE, "space-y-2.5 p-4")}>
          <p className="text-[13px] leading-5 text-stone-700">動態授權：把時間往前推</p>
          <p className="text-[12px] leading-5 text-stone-500">
            幼兒滿 2 歲後就換一種補助。授權不會自動沿用——條件變了，得重新比對、重新簽一張新的匣。
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: "今天", days: 0 },
              { label: "+6 個月", days: 183 },
              { label: "+13 個月", days: 400 },
            ].map((option) => (
              <Button
                key={option.days}
                size="sm"
                variant={view.clockOffsetDays === option.days ? "default" : "ghost"}
                className="rounded-full"
                disabled={busy}
                onClick={() => onClock(option.days)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
