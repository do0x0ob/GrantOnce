import { NextResponse } from "next/server";
import { submitApplication } from "@/lib/authz";
import { normalizeGrantId } from "@/lib/fields";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { grantId?: string };
  const grantId = body.grantId ? normalizeGrantId(body.grantId) : null;
  if (!grantId) {
    return NextResponse.json({ error: "無效的匣編號" }, { status: 400 });
  }
  const { state, error } = submitApplication(grantId);
  const view = principalView(state);
  if (error) {
    return NextResponse.json({ error, ...view }, { status: 409 });
  }
  return NextResponse.json(view);
}
