import { DemoApp } from "@/components/demo-app";
import { getState } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="flex h-svh flex-col overflow-hidden">
      <DemoApp initialView={principalView(getState())} />
    </main>
  );
}
