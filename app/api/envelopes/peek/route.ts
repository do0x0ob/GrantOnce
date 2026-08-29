import { NextResponse } from "next/server";
import { parsePresenter, peekEnvelope } from "@/lib/authz";
import { presenterLabel } from "@/lib/grant";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const presenterId = parsePresenter(request.headers.get("x-grantonce-presenter"));
  const body = (await request.json().catch(() => ({}))) as { grantId?: string };
  const token = body.grantId?.trim() ?? "";
  if (!token) {
    return NextResponse.json({ error: "缺少 grantId", state: null }, { status: 400 });
  }

  const caller = presenterId
    ? { id: presenterId, name: presenterLabel(presenterId) }
    : null;
  const { state, result } = peekEnvelope(token, caller);
  if (!result.ok) {
    return NextResponse.json({ ...result, state }, { status: 403 });
  }
  return NextResponse.json({ ...result, state });
}
