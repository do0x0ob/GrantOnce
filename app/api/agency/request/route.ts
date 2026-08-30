import { NextResponse } from "next/server";
import { requestClaims } from "@/lib/authz";
import { isKnownAgency } from "@/lib/parties";
import { isLivePurposeId } from "@/lib/registry-io";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

/** An agency asking for claims on its own initiative — screened before consent. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    agency?: string;
    purpose?: string;
    claims?: string[];
  };
  if (!body.agency || !isKnownAgency(body.agency)) {
    return NextResponse.json({ error: "未登記的機關" }, { status: 400 });
  }
  if (!body.purpose || !isLivePurposeId(body.purpose)) {
    return NextResponse.json({ error: "未登記的目的" }, { status: 400 });
  }
  const claims = Array.isArray(body.claims) ? body.claims : [];
  const { state, blocked, notes } = requestClaims(body.agency, body.purpose, claims);
  const view = principalView(state);
  if (blocked) {
    return NextResponse.json({ blocked, notes, error: notes[0], ...view }, { status: 403 });
  }
  return NextResponse.json({ blocked, notes, ...view });
}
