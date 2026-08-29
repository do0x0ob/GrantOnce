import { NextResponse } from "next/server";
import { signGrant } from "@/lib/authz";
import { normalizeGrantId } from "@/lib/fields";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    grantId?: string;
    signature?: string;
    publicKey?: string;
  };
  const grantId = body.grantId ? normalizeGrantId(body.grantId) : null;
  if (!grantId || !body.signature || !body.publicKey) {
    return NextResponse.json({ error: "需要 grantId、signature、publicKey" }, { status: 400 });
  }
  const { state, error } = signGrant({
    grantId,
    signature: body.signature,
    publicKey: body.publicKey,
  });
  if (error) {
    return NextResponse.json({ error, ...principalView(state) }, { status: 409 });
  }
  return NextResponse.json(principalView(state));
}
