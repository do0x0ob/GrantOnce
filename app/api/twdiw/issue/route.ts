import { NextResponse } from "next/server";
import { assertNoVaultLeak, fieldsFor, sandboxOff, wallet } from "@/lib/sdjwt-runtime";
import { appendAudit, getState, mutate } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function POST() {
  const off = sandboxOff();
  if (off) return NextResponse.json(off);

  const fields = fieldsFor(getState());
  let ticket;
  try {
    ticket = await wallet().issue(fields);
  } catch (thrown) {
    return NextResponse.json({ ok: false, reason: (thrown as Error).message }, { status: 502 });
  }

  const state = mutate((s) => {
    s.twdiwTicket = {
      issuance: ticket,
      cid: null,
      credential: null,
      revokedAt: null,
      presentation: null,
      lastResult: null,
    };
    appendAudit(s, {
      actor: "戶政事務所",
      actorRole: "issuer",
      action: "issue",
      detail: `向數位憑證皮夾沙盒送出發證請求，${Object.keys(fields).length} 個欄位`,
    });
  });
  const payload = principalView(state);
  assertNoVaultLeak(payload, "twdiw/issue");
  return NextResponse.json(payload);
}
