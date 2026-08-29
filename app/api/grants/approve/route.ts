import { NextResponse } from "next/server";
import { approveGrantAndFetch, isGrantId } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { grantId?: string };
  if (!body.grantId || !isGrantId(body.grantId)) {
    return NextResponse.json({ error: "無效的匣編號" }, { status: 400 });
  }
  const { state, error } = approveGrantAndFetch(body.grantId);
  if (error) {
    return NextResponse.json({ error, state }, { status: 409 });
  }
  return NextResponse.json(state);
}
