import { NextResponse } from "next/server";
import { isGrantId, revokeGrant } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    grantId?: string;
    reason?: string;
  };
  if (!body.grantId || !isGrantId(body.grantId)) {
    return NextResponse.json({ error: "無效的匣編號" }, { status: 400 });
  }
  const { state, error } = revokeGrant(
    body.grantId,
    body.reason ?? `委託人撤銷匣 ${body.grantId}`,
  );
  if (error) {
    return NextResponse.json({ error, state }, { status: 409 });
  }
  return NextResponse.json(state);
}
