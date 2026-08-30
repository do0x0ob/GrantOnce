import { CardHead } from "@/components/agent/card-head";
import { SURFACE } from "@/components/surface";
import { PURPOSES, type PurposeId } from "@/lib/purposes";
import { cn } from "@/lib/utils";
import type { PrincipalView } from "@/lib/view";

type Stage = { id: string; label: string; simulated: boolean };

/**
 * Where the application stands.
 *
 * The last two stages are drawn but never light up: this demo does not talk to
 * a real agency, and pretending otherwise is the kind of overclaim a government
 * reviewer is trained to look for. Showing the boundary is worth more than
 * showing a full bar.
 */
const STAGES: Stage[] = [
  { id: "matched", label: "比對", simulated: true },
  { id: "signed", label: "簽署", simulated: true },
  { id: "redeemed", label: "兌現", simulated: true },
  { id: "submitted", label: "送件", simulated: true },
  { id: "review", label: "機關審核", simulated: false },
  { id: "decided", label: "核定", simulated: false },
];

export function ApplicationStatusCard({
  purpose,
  view,
}: {
  purpose: PurposeId;
  view: PrincipalView;
}) {
  const def = PURPOSES[purpose];
  const inbox = view.inboxes[purpose];
  const grant = view.grants.find((g) => g.purpose === purpose);

  const reached = new Set<string>(["matched"]);
  if (grant && grant.status !== "proposed") reached.add("signed");
  if (grant?.status === "redeemed" || inbox?.receivedAt) reached.add("redeemed");
  if (inbox?.submittedAt) reached.add("submitted");

  return (
    <section className={cn(SURFACE, "space-y-4 px-6 py-5")}>
      <CardHead title={def.title} sub={`進度 · ${def.agencyName}`} />

      <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
        {STAGES.map((stage, i) => {
          const done = reached.has(stage.id);
          return (
            <li key={stage.id} className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-3 py-1 text-[12px] leading-5",
                  done
                    ? "bg-stone-900 text-stone-50"
                    : stage.simulated
                      ? "bg-stone-900/5 text-stone-500"
                      : "border border-dashed border-stone-900/20 text-stone-400",
                )}
              >
                {stage.label}
              </span>
              {i < STAGES.length - 1 ? (
                <span aria-hidden className="text-stone-300">
                  ›
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="text-[12px] leading-5 text-stone-500">
        虛線的兩格本演示沒有接真實機關，不會亮起。送件之後的事我們不模擬。
      </p>
    </section>
  );
}
