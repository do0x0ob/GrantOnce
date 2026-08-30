import { NextResponse } from "next/server";
import { shiftClock } from "@/lib/clock";
import { mutate } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

/**
 * Demo-only clock shift. Ages the child out of the 0–2 band on stage so the
 * dynamic re-authorisation is something you can watch rather than describe.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { offsetDays?: number };
  const state = mutate((s) => shiftClock(s, body.offsetDays ?? 0));
  return NextResponse.json(principalView(state));
}
