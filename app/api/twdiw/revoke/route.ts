import { NextResponse } from "next/server";
import { assertNoVaultLeak, sandboxOff, wallet } from "@/lib/sdjwt-runtime";
import { appendAudit, mutate, nowIso } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

/** One-way. The sandbox's action enum has no suspend and no restore. */
export async function POST(request: Request) {
  const off = sandboxOff();
  if (off) return NextResponse.json(off);
  const body = (await request.json().catch(() => ({}))) as { cid?: string };
  const cid = body.cid;
  if (!cid) return NextResponse.json({ error: "需要 cid" }, { status: 400 });

  try {
    await wallet().revoke(cid);
  } catch (thrown) {
    return NextResponse.json({ ok: false, reason: (thrown as Error).message }, { status: 502 });
  }

  const state = mutate((s) => {
    if (!s.twdiwTicket || s.twdiwTicket.cid !== cid) return;
    s.twdiwTicket.revokedAt = nowIso();
    appendAudit(s, {
      actor: "戶政事務所",
      actorRole: "issuer",
      action: "revoke",
      detail: `撤銷皮夾憑證 ${cid}（不可逆）`,
    });
  });
  const payload = principalView(state);
  assertNoVaultLeak(payload, "twdiw/revoke");
  return NextResponse.json(payload);
}
