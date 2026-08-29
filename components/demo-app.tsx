"use client";

import { useState } from "react";
import { AgencyPane } from "@/components/agency-pane";
import { PrincipalPane } from "@/components/principal-pane";
import { VaultPane } from "@/components/vault-pane";
import { Button } from "@/components/ui/button";
import { useDemo } from "@/hooks/use-demo";
import type { PrincipalView } from "@/lib/view";

const PANES = [
  { id: "principal", label: "皮夾" },
  { id: "vault", label: "金庫" },
  { id: "agency", label: "機關" },
] as const;

type PaneId = (typeof PANES)[number]["id"];

export function DemoApp({ initialView }: { initialView: PrincipalView }) {
  const demo = useDemo(initialView);
  const [pane, setPane] = useState<PaneId>("principal");
  const [contrast, setContrast] = useState(false);
  const fatFields = fatEnvelopeFields(demo.state);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-[#F6F3EE]">
      <header className="flex shrink-0 items-baseline justify-between gap-3 px-6 py-3.5">
        <p className="text-[15px] leading-6 tracking-tight text-stone-800">
          GrantOnce
          <span className="ml-2 text-stone-400">分匣授權</span>
          <span className="ml-3 hidden text-[13px] text-stone-400 sm:inline">
            兩把鑰匙才開得了：你的簽章，加上機關的法定職務。
          </span>
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={`rounded-full ${contrast ? "text-rose-600 hover:text-rose-700" : "text-stone-400 hover:text-stone-600"}`}
            aria-pressed={contrast}
            onClick={() => setContrast((value) => !value)}
          >
            {contrast ? "回到分匣" : "對照胖授權"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full text-stone-400 hover:text-stone-600"
            disabled={demo.busy}
            onClick={() => void demo.reset()}
          >
            重設
          </Button>
        </div>
      </header>

      {contrast ? (
        <p className="px-6 pb-2 text-[13px] leading-5 text-rose-600">
          錯的解法是給代理人一張胖 token。fields:* — 甲乙都看到全部，包括所得。
        </p>
      ) : null}

      {demo.error ? (
        <p className="px-6 pb-2 text-[13px] leading-5 text-rose-600">{demo.error}</p>
      ) : null}

      <nav className="flex shrink-0 gap-1 px-5 pb-2 lg:hidden">
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

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 px-6 pb-6 lg:grid-cols-[minmax(20rem,1.1fr)_minmax(17rem,0.9fr)_minmax(22rem,1.2fr)]">
        <section
          className={`min-h-0 overflow-hidden ${pane === "principal" ? "flex flex-col" : "hidden"} lg:flex lg:flex-col`}
        >
          <PrincipalPane demo={demo} />
        </section>
        <section
          className={`min-h-0 overflow-hidden ${pane === "vault" ? "flex flex-col" : "hidden"} lg:flex lg:flex-col`}
        >
          <VaultPane
            view={demo.view}
            busy={demo.busy}
            onClock={(days) => void demo.setClock(days)}
          />
        </section>
        <section
          className={`min-h-0 overflow-hidden ${pane === "agency" ? "flex flex-col" : "hidden"} lg:flex lg:flex-col`}
        >
          <AgencyPane demo={demo} />
        </section>
      </div>
    </div>
  );
}
