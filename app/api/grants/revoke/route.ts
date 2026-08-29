import { NextResponse } from "next/server";
import { asGrantId, revokeGrant } from "@/lib/authz";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    grantId?: string;
    reason?: string;
  };
  const grantId = body.grantId ? asGrantId(body.grantId) : null;
  if (!grantId) {
    return NextResponse.json({ error: "無效的匣編號" }, { status: 400 });
  }
  const issuer = getState().principal.id;
  const { state, result } = revokeGrant(
    grantId,
    body.reason ?? `委託人撤銷匣 ${grantId}`,
    { id: issuer },
  );
  if (!result.ok) {
    return NextResponse.json({ ...result, state }, { status: 403 });
  }
  return NextResponse.json(state);
}
