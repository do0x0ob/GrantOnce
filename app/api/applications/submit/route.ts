import { NextResponse } from "next/server";
import { actorLabel, asGrantId, parseActorId, submitApplication } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    grantId?: string;
    actor?: string;
  };
  const grantId = body.grantId ? asGrantId(body.grantId) : null;
  if (!grantId) {
    return NextResponse.json({ error: "無效的匣編號" }, { status: 400 });
  }
  const actorId = parseActorId(body.actor);
  const { state, result } = submitApplication(
    grantId,
    actorId ? { id: actorId, name: actorLabel(actorId) } : null,
  );
  if (!result.ok) {
    return NextResponse.json({ ...result, state }, { status: 403 });
  }
  return NextResponse.json(state);
}
