import { NextResponse } from "next/server";
import { makeAgencyProof, redeemGrant } from "@/lib/authz";
import { normalizeGrantId } from "@/lib/fields";
import { isKnownAgency } from "@/lib/parties";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

/**
 * Stands in for the agency's own client. The proof is minted with the agency's
 * key here only because one process plays every role in the demo; the check on
 * the other side is the real one.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    grantId?: string;
    agency?: string;
  };
  const grantId = body.grantId ? normalizeGrantId(body.grantId) : null;
  if (!grantId) {
    return NextResponse.json({ error: "無效的匣編號" }, { status: 400 });
  }
  if (!body.agency || !isKnownAgency(body.agency)) {
    return NextResponse.json({ error: "未登記的機關" }, { status: 400 });
  }

  const proof = makeAgencyProof(body.agency, grantId);
  const { state, result } = redeemGrant(grantId, proof);
  const view = principalView(state);
  if (!result.ok) {
    return NextResponse.json({ ...result, ...view }, { status: 403 });
  }
  return NextResponse.json({ ...result, ...view });
}
