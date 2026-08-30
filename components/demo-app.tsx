"use client";

import { useEffect, useRef, useState } from "react";
import { AgencyPane } from "@/components/agency-pane";
import { BrandMark } from "@/components/brand-mark";
import { PrincipalPane } from "@/components/principal-pane";
import { RegistryPane } from "@/components/registry-pane";
import { VaultPane } from "@/components/vault-pane";
import { Button } from "@/components/ui/button";
import { useDemo } from "@/hooks/use-demo";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/view";
import type { PrincipalView } from "@/lib/view";

const VIEWS = [
  { id: "authorize", label: "授權" },
  { id: "vault", label: "金庫" },
  { id: "agency", label: "機關" },
  { id: "registry", label: "登記台" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

export function DemoApp({ initialView }: { initialView: PrincipalView }) {
  const demo = useDemo(initialView);
  const [viewId, setViewId] = useState<ViewId>("authorize");
  const seen = useRef(new Set<string>());
  const booted = useRef(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [viewId]);

  useEffect(() => {
    const ids = demo.view.notifications.map((n) => n.id);
    if (!booted.current) {
      booted.current = true;
      for (const id of ids) seen.current.add(id);
      return;
    }
    const fresh = demo.view.notifications.filter((n) => !seen.current.has(n.id));
    for (const id of ids) seen.current.add(id);
    if (fresh.some((n) => n.kind === "risk")) setViewId("authorize");
  }, [demo.view.notifications]);

  const pending = demo.view.grants.filter((g) => g.status === "proposed").length;
  const inboxReady = Object.values(demo.view.inboxes).some((box) => box.receivedAt);

  return (
    <div className="min-h-svh bg-[#E8E4DE]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)]/70 bg-[#E8E4DE]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[72rem] flex-col gap-3 px-6 py-3 sm:h-16 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:py-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-stone-800">
              <BrandMark className="size-7" />
              <div className="leading-tight">
                <p className="text-[15px] font-medium tracking-tight">GrantOnce</p>
                <p className="text-[12px] text-stone-400">分匣授權</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-stone-400 hover:text-stone-700 sm:hidden"
              disabled={demo.busy}
              onClick={() => {
                setViewId("authorize");
                void demo.reset();
              }}
            >
              重設
            </Button>
          </div>

          <nav className="flex items-center gap-0.5 self-start rounded-full bg-white/70 p-1 shadow-[0_1px_0_rgba(26,24,20,0.04)] sm:self-auto">
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setViewId(item.id)}
                className={cn(
                  "relative rounded-full px-3.5 py-1.5 text-[13px] leading-5 transition-colors",
                  viewId === item.id
                    ? "bg-[var(--ink)] text-[var(--primary-foreground)]"
                    : "text-stone-500 hover:text-stone-800",
                )}
              >
                {item.label}
                {item.id === "authorize" && pending > 0 && viewId !== "authorize" ? (
                  <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--orchid)]" />
                ) : null}
                {item.id === "agency" && inboxReady && viewId !== "agency" ? (
                  <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[var(--sage)]" />
                ) : null}
              </button>
            ))}
          </nav>

          <div className="hidden items-center gap-3 sm:flex">
            {/* Makes 「它一直在看」 something you can point at, rather than a claim. */}
            <p className="text-[13px] text-stone-400">
              代理人上次巡檢：
              {demo.view.lastTickAt ? formatTime(demo.view.lastTickAt) : "尚未巡檢"}
            </p>
            <p className="text-[13px] text-stone-400">{demo.view.principal.name}</p>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-stone-400 hover:text-stone-700"
              disabled={demo.busy}
              onClick={() => {
                setViewId("authorize");
                void demo.reset();
              }}
            >
              重設
            </Button>
          </div>
        </div>
      </header>

      {demo.error ? (
        <p className="mx-auto max-w-[40rem] px-6 pt-4 text-[14px] leading-6 text-[var(--orchid-deep)]">
          {demo.error}
        </p>
      ) : null}

      {viewId === "authorize" ? (
        <PrincipalPane demo={demo} onOpenAgency={() => setViewId("agency")} />
      ) : null}
      {viewId === "vault" ? (
        <VaultPane
          view={demo.view}
          busy={demo.busy}
          onClock={(days) => void demo.setClock(days)}
          onScan={() => void demo.scanNotifications()}
        />
      ) : null}
      {viewId === "agency" ? <AgencyPane demo={demo} /> : null}
      {viewId === "registry" ? <RegistryPane demo={demo} /> : null}
    </div>
  );
}
