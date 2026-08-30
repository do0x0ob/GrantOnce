import { cn } from "@/lib/utils";

/**
 * Who asks you to sign, and who hands them the data.
 *
 * Laid out as three from → to steps rather than two labelled fields, because the
 * question people actually ask is about the relationship: the agency that wants
 * your signature is not the one holding your records, and what it receives comes
 * straight from that source. Drawn in HTML rather than SVG because agency names
 * run from 「戶政事務所」 to 「經濟部能源署 × 台灣電力公司」, and fixed geometry
 * cannot hold both.
 */
export function DataFlowDiagram({
  requesterName,
  sourceNames,
  claimCount,
}: {
  requesterName: string;
  sourceNames: string[];
  claimCount: number;
}) {
  const source = sourceNames.join("、");

  const steps = [
    {
      from: "你",
      to: requesterName,
      what: "你簽一張只授權這一次的匣。私鑰留在你的認證器裡，模型碰不到。",
      emphasis: "跟你要簽名的是這裡",
    },
    {
      from: requesterName,
      to: source,
      what: "它帶著那張匣去要資料，並且要出示自己的金鑰，證明匣是發給它的。",
      emphasis: null,
    },
    {
      from: source,
      to: requesterName,
      what: `兩把鑰匙都驗過，才放行 ${claimCount} 項述詞——直接交給辦理機關。`,
      emphasis: "原始資料留在這裡，不經過你，也不經過模型",
    },
  ];

  return (
    <ol className="space-y-3">
      {steps.map((step, index) => (
        <li key={index} className="flex gap-3">
          <span
            className={cn(
              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
              "bg-[color-mix(in_oklab,var(--ink)_8%,transparent)] text-[11px] leading-none text-stone-500",
            )}
          >
            {index + 1}
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-[14px] leading-6 text-stone-700">
              {step.from}
              <span className="mx-1.5 text-stone-400">→</span>
              {step.to}
            </p>
            <p className="text-[13px] leading-6 text-stone-500">{step.what}</p>
            {step.emphasis ? (
              <p className="text-[12px] leading-5 text-stone-400">{step.emphasis}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
