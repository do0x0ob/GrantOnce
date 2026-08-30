import { NextResponse } from "next/server";
import { assertNoVaultLeak, sandboxOff, wallet } from "@/lib/sdjwt-runtime";
import { mutate } from "@/lib/store";
import type { VpProfile } from "@/lib/twdiw";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

const PROFILES: VpProfile[] = ["childcare_full", "childcare_partial"];

export async function POST(request: Request) {
  const off = sandboxOff();
  if (off) return NextResponse.json(off);
  const body = (await request.json().catch(() => ({}))) as { vp?: string };
  const vp = PROFILES.find((p) => p === body.vp);
  if (!vp) return NextResponse.json({ error: "未知的出示樣板" }, { status: 400 });

  let ticket;
  try {
    ticket = await wallet().present(vp);
  } catch (thrown) {
    return NextResponse.json({ ok: false, reason: (thrown as Error).message }, { status: 502 });
  }

  const state = mutate((s) => {
    if (!s.twdiwTicket) return;
    s.twdiwTicket.presentation = { ticket, vp };
    s.twdiwTicket.lastResult = null;
  });
  const payload = principalView(state);
  assertNoVaultLeak(payload, "twdiw/present");
  return NextResponse.json(payload);
}
