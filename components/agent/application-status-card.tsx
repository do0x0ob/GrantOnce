"use client";

import { useState } from "react";
import { RAIL } from "@/components/surface";
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
  const [opened, setOpened] = useState(false);
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

  const current = [...STAGES].reverse().find((stage) => reached.has(stage.id)) ?? STAGES[0];

  return (
    <section className={cn(RAIL, "w-[15.5rem] shrink-0 px-3.5 py-3 lg:w-full")}>
      <button
        type="button"
        className="flex w-full cursor-pointer items-start justify-between gap-2 text-left"
        aria-expanded={opened}
        onClick={() => setOpened((value) => !value)}
      >
        <div className="min-w-0">
          <p className="truncate text-[13px] leading-5 text-stone-600">{def.title}</p>
          <p className="truncate text-[11px] leading-4 text-stone-400">進度 · {def.agencyName}</p>
        </div>
        <span className="shrink-0 rounded-full bg-stone-900 px-2 py-0.5 text-[11px] leading-4 text-stone-50">
          {current.label}
        </span>
      </button>

      {opened ? (
        <div className="mt-3 space-y-3">
          <ol className="space-y-1.5">
            {STAGES.map((stage) => {
              const done = reached.has(stage.id);
              return (
                <li
                  key={stage.id}
                  className={cn(
                    "flex items-center gap-2 text-[12px] leading-5",
                    done ? "text-stone-700" : "text-stone-400",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      done
                        ? "bg-stone-800"
                        : stage.simulated
                          ? "bg-stone-300"
                          : "border border-dashed border-stone-400 bg-transparent",
                    )}
                  />
                  {stage.label}
                </li>
              );
            })}
          </ol>
          <p className="text-[11px] leading-4 text-stone-400">
            「回覆結果」只有手動切換案件狀態時才會亮，不代表已串真實機關。
          </p>
        </div>
      ) : null}
    </section>
  );
}
