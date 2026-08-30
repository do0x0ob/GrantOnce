import { NextResponse } from "next/server";
import { assertNoVaultLeak } from "@/lib/sdjwt-runtime";
import { present } from "@/lib/sdjwt";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Builds a presentation from the disclosures the holder picked.
 *
 * No key binding is produced here, and that is not a shortcut: the principal's
 * ed25519 key is derived from the passkey PRF inside the browser and never
 * reaches this process, so there is nothing here that could sign a KB-JWT. The
 * *verification* side is implemented and covered in `test/sdjwt.ts`.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    disclose?: string[];
    aud?: string;
    nonce?: string;
  };
  const issued = getState().sdJwtDemo;
  if (!issued) return NextResponse.json({ error: "還沒有 SD-JWT，先發一張" }, { status: 409 });

  try {
    const combined = present({ issued, disclose: body.disclose ?? [] });
    const payload = {
      combined,
      length: combined.length,
      disclosed: body.disclose ?? [],
      aud: body.aud ?? null,
      nonce: body.nonce ?? null,
      keyBinding: false,
      keyBindingNote: "委託人的私鑰只在瀏覽器裡，伺服器這一端不產生 KB-JWT；驗證端的 KB 檢查已實作。",
    };
    assertNoVaultLeak(payload, "sdjwt/present");
    return NextResponse.json(payload);
  } catch (thrown) {
    return NextResponse.json({ error: (thrown as Error).message }, { status: 400 });
  }
}
