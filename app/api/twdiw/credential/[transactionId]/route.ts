import { NextResponse } from "next/server";
import { assertNoVaultLeak, sandboxOff, wallet } from "@/lib/sdjwt-runtime";
import { mutate } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ transactionId: string }> },
) {
  const off = sandboxOff();
  if (off) return NextResponse.json(off);
  const { transactionId } = await context.params;

  let result;
  try {
    result = await wallet().getCredential(transactionId);
  } catch (thrown) {
    return NextResponse.json({ ok: false, reason: (thrown as Error).message }, { status: 404 });
  }

  const state = mutate((s) => {
    if (s.twdiwTicket?.issuance.transactionId !== transactionId) return;
    s.twdiwTicket.cid = result.cid;
    s.twdiwTicket.credential = result.credential;
  });
  const payload = { ...result, ...principalView(state) };
  assertNoVaultLeak(payload, "twdiw/credential");
  return NextResponse.json(payload);
}
