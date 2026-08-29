import { NextResponse } from "next/server";
import { actorLabel, fetchWithGrant, parseActorId, parseGrantBearer } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const grantId = parseGrantBearer(request.headers.get("authorization"));
  if (!grantId) {
    return NextResponse.json(
      { error: "請使用 Authorization: Bearer Grant <id>", state: null },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    fields?: string[];
    actor?: string;
    actorName?: string;
  };
  const fields = Array.isArray(body.fields) ? body.fields : [];
  const actorId = parseActorId(body.actor);
  const name = body.actorName ?? (actorId ? actorLabel(actorId) : undefined);

  const { state, result } = fetchWithGrant(
    grantId,
    fields,
    actorId ? { id: actorId, name } : null,
  );
  if (!result.ok) {
    return NextResponse.json({ ...result, state }, { status: 403 });
  }
  return NextResponse.json({ ...result, state });
}
