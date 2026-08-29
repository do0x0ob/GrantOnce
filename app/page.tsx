import { DemoApp } from "@/components/demo-app";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function Home() {
  const initialState = getState();
  return (
    <main className="flex h-svh flex-col overflow-hidden">
      <DemoApp initialState={initialState} />
    </main>
  );
}
