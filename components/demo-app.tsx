"use client";

import { useState } from "react";
import { AgencyPane } from "@/components/agency-pane";
import { AgentPane } from "@/components/agent-pane";
import { PrincipalPane } from "@/components/principal-pane";
import { Button } from "@/components/ui/button";
import { HOUSEHOLD_FIELDS, JIA_FIELDS } from "@/lib/fields";
import type { DemoState } from "@/lib/types";
import { useDemo } from "@/hooks/use-demo";

const PANES = [
  { id: "principal", label: "委託人" },
  { id: "agent", label: "代理人" },
  { id: "agency", label: "機關＋稽核" },
] as const;

type PaneId = (typeof PANES)[number]["id"];

export function DemoApp({ initialState }: { initialState: DemoState }) {
  const demo = useDemo(initialState);
  const [pane, setPane] = useState<PaneId>("principal");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-stone-300/80 bg-[#fbf7ee]/90 px-4 py-3 backdrop-blur">
        <div>
          <p className="font-serif text-2xl tracking-wide text-stone-900">
            GrantOnce <span className="text-lg text-stone-600">分匣授權</span>
          </p>
          <p className="text-sm text-stone-700">只准這一次，而且只准這一匣。</p>
          <p className="text-[11px] text-stone-500">
            假 MyData · 假送件 · 授權層是 Grant，不是帳號權限
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={demo.busy} onClick={() => void demo.reset()}>
          重設演示
        </Button>
      </header>

      {demo.error ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-900">
          {demo.error}
        </div>
      ) : null}

      <nav className="flex shrink-0 gap-1 border-b border-stone-300/80 bg-[#f4efe4] px-3 py-2 xl:hidden">
        {PANES.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={pane === item.id ? "default" : "ghost"}
            onClick={() => setPane(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </nav>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-3">
        <section
          className={`min-h-0 overflow-auto border-stone-300/80 p-4 xl:block xl:border-r ${pane === "principal" ? "block" : "hidden"}`}
        >
          <PrincipalPane
            state={demo.state}
            busy={demo.busy}
            onSend={demo.sendChat}
            onApprove={demo.approve}
            onRevoke={demo.revoke}
          />
        </section>
        <section
          className={`min-h-0 overflow-auto border-stone-300/80 p-4 xl:block xl:border-r ${pane === "agent" ? "block" : "hidden"}`}
        >
          <AgentPane state={demo.state} />
        </section>
        <section
          className={`min-h-0 overflow-auto p-4 xl:block ${pane === "agency" ? "block" : "hidden"}`}
        >
          <AgencyPane
            state={demo.state}
            busy={demo.busy}
            onOverscope={() =>
              demo.fetchMyData({
                grantId: "G-乙",
                fields: HOUSEHOLD_FIELDS,
                actor: "agency-yi",
              })
            }
            onSubmitJia={() => demo.submit("G-甲")}
            onReplayJia={() =>
              demo.fetchMyData({
                grantId: "G-甲",
                fields: JIA_FIELDS,
                actor: "agency-jia",
              })
            }
          />
        </section>
      </div>
    </div>
  );
}
