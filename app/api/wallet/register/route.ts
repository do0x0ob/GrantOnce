import { NextResponse } from "next/server";
import { registerPrincipalKey } from "@/lib/authz";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    publicKey?: string;
    method?: "passkey" | "software";
    credentialId?: string | null;
  };
  if (!body.publicKey || (body.method !== "passkey" && body.method !== "software")) {
    return NextResponse.json({ error: "需要 publicKey 與 method" }, { status: 400 });
  }
  const { state, error } = registerPrincipalKey({
    publicKey: body.publicKey,
    method: body.method,
    credentialId: body.credentialId ?? null,
  });
  if (error) {
    return NextResponse.json({ error, ...principalView(state) }, { status: 400 });
  }
  return NextResponse.json(principalView(state));
}
