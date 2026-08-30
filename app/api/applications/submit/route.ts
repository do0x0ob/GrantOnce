import { NextResponse } from "next/server";
import { submitApplication } from "@/lib/authz";
import { normalizeGrantId } from "@/lib/purposes";
import { mutate, reconcileApplications } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { grantId?: string };
  const grantId = body.grantId ? normalizeGrantId(body.grantId) : null;
  if (!grantId) {
    return NextResponse.json({ error: "無效的匣編號" }, { status: 400 });
  }
  const { state, error } = submitApplication(grantId);
  if (error) {
    return NextResponse.json({ error, ...principalView(state) }, { status: 409 });
  }
  // Keep the demo's application-status fixture in step without reaching into
  // the redemption ladder to do it.
  return NextResponse.json(principalView(mutate(reconcileApplications)));
}
