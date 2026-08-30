import { CardHead } from "@/components/agent/card-head";
import { SURFACE } from "@/components/surface";
import type { PurposeId } from "@/lib/purposes";
import { cn } from "@/lib/utils";
import type { PrincipalView } from "@/lib/view";

/**
 * Stage 3, as its own beat rather than a line buried in a capsule.
 *
 * This runs only after the person has confirmed the requirement, which is the
 * point: the question 「這個機關有沒有權力要」 is asked once they have said they
 * want the service, not before.
 */
export function LegalCheckCard({ purpose, view }: { purpose: PurposeId; view: PrincipalView }) {
  const request = [...view.serviceRequests]
    .reverse()
    .find((item) => item.purpose === purpose && item.confirmedAt);

  if (!request) return null;

  const passed = request.status !== "blocked";
  const rawCount = request.claims.filter((claim) => claim.claimId.startsWith("raw.")).length;

  const rows: { label: string; value: string; ok: boolean }[] = [
    {
      label: "目的登記",
      value: passed ? `${request.title} 已登記於 ${request.requesterName}` : "未通過",
      ok: passed,
    },
    {
      label: "個資依據",
      value: request.privacyBasis.join("；") || "未載明",
      ok: request.privacyBasis.length > 0,
    },
    {
      label: "最小範圍",
      value: `述詞 ${request.claims.length} 項，原始欄位 ${rawCount} 項`,
      ok: rawCount === 0,
    },
  ];

  return (
    <section className={cn(SURFACE, "space-y-5 px-6 py-5")}>
      <CardHead
        title={passed ? "目的與法源檢查通過" : "目的與法源檢查未通過"}
        sub={`${request.title} · 於你確認之後才執行`}
      />

      <dl className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline gap-3">
            <dt className="w-20 shrink-0 text-[12px] leading-6 text-stone-400">{row.label}</dt>
            <dd className="flex-1 text-[14px] leading-6 text-stone-700">{row.value}</dd>
            <span
              className={cn(
                "shrink-0 text-[13px] leading-6",
                row.ok ? "text-[var(--sage)]" : "text-[var(--orchid-deep)]",
              )}
            >
              {row.ok ? "✓" : "✗"}
            </span>
          </div>
        ))}
      </dl>

      {request.checkNotes.length ? (
        <ul className="space-y-1.5 border-t border-stone-900/5 pt-4">
          {request.checkNotes.map((note) => (
            <li key={note} className="text-[13px] leading-6 text-[var(--orchid-deep)]">
              {note}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-[13px] leading-6 text-stone-500">
        {passed
          ? `檢查通過才鑄出授權匣。匣裡帶的是述詞，${
              rawCount === 0 ? "沒有任何原始欄位" : `其中 ${rawCount} 項是原始欄位`
            }；在你簽署之前它不能兌現。`
          : "檢查沒過，所以沒有鑄出任何可簽署的匣。"}
      </p>
    </section>
  );
}
