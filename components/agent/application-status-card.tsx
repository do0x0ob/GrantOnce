import { CardHead } from "@/components/agent/card-head";
import { SURFACE } from "@/components/surface";
import { PURPOSES, type PurposeId } from "@/lib/purposes";
import { cn } from "@/lib/utils";
import type { PrincipalView } from "@/lib/view";

type Stage = { id: string; label: string; simulated: boolean };

/**
 * Where the application stands.
 *
 * Every stage is driven by the service-request record. The result stage can be
 * advanced manually for the demo, but is styled as simulated because no real
 * agency system is connected.
 */
const STAGES: Stage[] = [
  { id: "found", label: "找到服務", simulated: true },
  { id: "requirements", label: "確認需求", simulated: true },
  { id: "signed", label: "使用者簽署", simulated: true },
  { id: "delivered", label: "來源交付", simulated: true },
  { id: "processing", label: "機關處理", simulated: true },
  { id: "result", label: "回覆結果", simulated: false },
];

export function ApplicationStatusCard({
  purpose,
  view,
}: {
  purpose: PurposeId;
  view: PrincipalView;
}) {
  const def = PURPOSES[purpose];
  const request = [...view.serviceRequests].reverse().find((item) => item.purpose === purpose);

  const reached = new Set<string>(["found"]);
  if (request) reached.add("requirements");
  if (request && ["authorized", "data-delivered", "processing", "completed"].includes(request.status)) {
    reached.add("signed");
  }
  if (request && ["data-delivered", "processing", "completed"].includes(request.status)) {
    reached.add("delivered");
  }
  if (request && ["processing", "completed"].includes(request.status)) reached.add("processing");
  if (request?.status === "completed") reached.add("result");

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
        本演示會模擬到機關處理；「回覆結果」只有手動切換案件狀態時才會亮起，不代表已串接真實機關。
      </p>
    </section>
  );
}
