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
    <div className="flex h-full min-h-0 flex-1 flex-col bg-white">
      <header className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
        <div>
          <p className="text-[15px] font-medium tracking-tight text-neutral-900">
            GrantOnce
            <span className="ml-2 font-normal text-neutral-500">分匣授權</span>
          </p>
          <p className="text-[13px] text-neutral-500">只准這一次，而且只准這一匣。</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full border-neutral-200"
          disabled={demo.busy}
          onClick={() => void demo.reset()}
        >
          重設
        </Button>
      </header>

      {demo.error ? (
        <div className="mx-5 mb-2 rounded-2xl bg-rose-50 px-4 py-2 text-[13px] text-rose-700">
          {demo.error}
        </div>
      ) : null}

      <nav className="flex shrink-0 gap-1 px-4 pb-2 xl:hidden">
        {PANES.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={pane === item.id ? "default" : "ghost"}
            className="rounded-full"
            onClick={() => setPane(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </nav>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-3 xl:grid-cols-3">
        <section
          className={`min-h-0 overflow-hidden rounded-[24px] bg-[#F5F5F5] p-4 xl:flex xl:flex-col ${pane === "principal" ? "flex flex-col" : "hidden"}`}
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
          className={`min-h-0 overflow-auto rounded-[24px] bg-[#F5F5F5] p-4 xl:block ${pane === "agent" ? "block" : "hidden"}`}
        >
          <AgentPane state={demo.state} />
        </section>
        <section
          className={`min-h-0 overflow-auto rounded-[24px] bg-[#F5F5F5] p-4 xl:block ${pane === "agency" ? "block" : "hidden"}`}
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
