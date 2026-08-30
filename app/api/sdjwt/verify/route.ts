import { NextResponse } from "next/server";
import { assertNoVaultLeak } from "@/lib/sdjwt-runtime";
import { b64u } from "@/lib/crypto";
import { ISSUER_KEYS } from "@/lib/parties";
import { effectiveNow } from "@/lib/rules";
import { verify } from "@/lib/sdjwt";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    combined?: string;
    aud?: string;
    nonce?: string;
  };
  if (!body.combined) return NextResponse.json({ error: "需要 combined" }, { status: 400 });

  const result = verify({
    combined: body.combined,
    issuerPublicKey: b64u(ISSUER_KEYS["household-office"].publicKey),
    now: effectiveNow(getState()),
    expect: body.aud && body.nonce ? { aud: body.aud, nonce: body.nonce } : undefined,
  });
  assertNoVaultLeak(result, "sdjwt/verify");
  return NextResponse.json(result);
}
