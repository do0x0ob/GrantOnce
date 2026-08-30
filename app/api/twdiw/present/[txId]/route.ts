import { NextResponse } from "next/server";
import { assertNoVaultLeak, sandboxOff, wallet } from "@/lib/sdjwt-runtime";
import { mutate } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ txId: string }> }) {
  const off = sandboxOff();
  if (off) return NextResponse.json(off);
  const { txId } = await context.params;

  let result;
  try {
    result = await wallet().result(txId);
  } catch (thrown) {
    return NextResponse.json({ ok: false, reason: (thrown as Error).message }, { status: 501 });
  }

  const state = mutate((s) => {
    if (s.twdiwTicket?.presentation?.ticket.txId !== txId) return;
    s.twdiwTicket.lastResult = result;
  });
  const payload = { result, ...principalView(state) };
  assertNoVaultLeak(payload, "twdiw/present-result");
  return NextResponse.json(payload);
}
