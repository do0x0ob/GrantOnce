import { NextResponse } from "next/server";
import { assertNoVaultLeak, predicatesFor } from "@/lib/sdjwt-runtime";
import { effectiveNow } from "@/lib/rules";
import { issue } from "@/lib/sdjwt";
import { credentialTtlDays } from "@/lib/twdiw";
import { appendAudit, mutate } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

/**
 * Mints one SD-JWT beside the capsule layer. `state.wallet` and `redeemGrant`
 * are not touched: this is the credential the holder could take to a wallet,
 * not the capsule an agency redeems.
 */
export async function POST() {
  let error: string | null = null;
  const state = mutate((s) => {
    const holderPublicKey = s.principal.key.publicKey;
    if (!holderPublicKey) {
      error = "還沒有委託人金鑰，憑證無從綁定持有人（cnf.jwk）";
      return;
    }
    const now = effectiveNow(s);
    s.sdJwtDemo = issue({
      claims: predicatesFor(s),
      issuer: "household-office",
      holderPublicKey,
      ttlDays: credentialTtlDays(),
      now,
    });
    appendAudit(s, {
      actor: "戶政事務所",
      actorRole: "issuer",
      action: "issue",
      detail: `簽發 SD-JWT 述詞憑證，${s.sdJwtDemo.disclosures.length} 筆 disclosure，效期 ${credentialTtlDays()} 天`,
    });
  });
  if (error) return NextResponse.json({ error }, { status: 409 });
  const payload = principalView(state);
  assertNoVaultLeak(payload, "sdjwt/issue");
  return NextResponse.json(payload);
}
