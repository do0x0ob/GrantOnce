import { NextResponse } from "next/server";
import { approveGrantAndFetch, asGrantId } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    grantId?: string;
    issuer?: string;
  };
  const grantId = body.grantId ? asGrantId(body.grantId) : null;
  if (!grantId) {
    return NextResponse.json({ error: "無效的匣編號" }, { status: 400 });
  }
  const { state, error } = approveGrantAndFetch(grantId, {
    issuer: body.issuer,
  });
  if (error) {
    return NextResponse.json({ error, state }, { status: 409 });
  }
  return NextResponse.json(state);
}
