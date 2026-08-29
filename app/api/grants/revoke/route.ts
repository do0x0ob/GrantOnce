import { NextResponse } from "next/server";
import { actorLabel, asGrantId, parseActorId, revokeGrant } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    grantId?: string;
    reason?: string;
    caller?: string;
  };
  const grantId = body.grantId ? asGrantId(body.grantId) : null;
  if (!grantId) {
    return NextResponse.json({ error: "無效的匣編號" }, { status: 400 });
  }
  const callerId = parseActorId(body.caller);
  const { state, result } = revokeGrant(
    grantId,
    body.reason ?? `委託人撤銷匣 ${grantId}`,
    callerId ? { id: callerId, name: actorLabel(callerId) } : null,
  );
  if (!result.ok) {
    return NextResponse.json({ ...result, state }, { status: 403 });
  }
  return NextResponse.json(state);
}
