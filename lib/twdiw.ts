/**
 * 數位憑證皮夾（TW DIW）sandbox adapter.
 *
 * The capsule layer is untouched: nothing here can mint, sign or redeem a
 * Grant. This is the *credential supply* line — the same four predicates the
 * issuer already derives, pushed into a wallet the citizen actually holds,
 * so 「憑證重用」 stops being a claim about our own JSON file.
 *
 * Two implementations. `FixtureTwdiw` is complete and makes no network calls at
 * all; it is what the tests and the offline demo run against. `SandboxTwdiw`
 * talks to the real issuer sandbox, and its two verifier calls throw until the
 * DWVP endpoint paths are published — see the interface note on `present`.
 *
 * Default is off. With `TWDIW_ENABLED` unset — or set without a `TWDIW_VC_UID`
 * to put in the request — nothing in this module opens a socket.
 */
import { CLAIM_DEFS, type ClaimId } from "./claims";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2";
import { b64u, randomId, unb64u, utf8 } from "./crypto";
import { SD_JWT_TYP, sdDigest } from "./sdjwt";
import type { DemoState } from "./types";

export type IssuanceTicket = {
  transactionId: string;
  /** The sandbox returns a PNG data URI; render it, do not re-draw the QR. */
  qrCodeDataUri: string;
  /**
   * An HTTPS wrapper — `https://frontend-uat.wallet.gov.tw/api/moda/vcqrcode?…`
   * — whose inner base64 payload is the `modadigitalwallet://` link. Put it in
   * an `<a href>` exactly as it arrived: decoding it and rebuilding the scheme
   * URL by hand drops whatever else the wrapper carries, and the wrapper is the
   * part that works on a desktop browser.
   */
  deepLink: string;
  expiresAt: string;
};

export type PresentationTicket = { authUri: string; txId: string; expiresAt: string };

export type PresentationResult =
  | { status: "pending" }
  | { status: "done"; disclosed: Record<string, string>; rawPresentation?: string }
  | { status: "failed"; reason: string };

export type VpProfile = "childcare_full" | "childcare_partial";

export interface TwdiwAdapter {
  issue(claims: Record<string, string>): Promise<IssuanceTicket>;
  getCredential(transactionId: string): Promise<{ credential: string; cid: string }>;
  revoke(cid: string): Promise<void>;
  present(vp: VpProfile): Promise<PresentationTicket>;
  result(txId: string): Promise<PresentationResult>;
}

/**
 * §5.2 的對照表。`ename` is the sandbox's field name; the value is whatever
 * `CLAIM_DEFS[...].compute()` returns, as a string, with no coercion — the vault
 * is read in exactly one place and this is not a second one.
 */
export const TWDIW_FIELDS: { claimId: ClaimId; ename: string }[] = [
  { claimId: "resident.inNewTaipei", ename: "residentInNewTaipei" },
  { claimId: "resident.movedWithin12m", ename: "movedWithin12m" },
  { claimId: "parentChild.verified", ename: "parentChildVerified" },
  { claimId: "child.ageBand", ename: "childAgeBand" },
];

/** Marks every credential this demo mints as synthetic, wherever it ends up. */
export const SYNTHETIC_FIELD = { ename: "syntheticData", content: "true" };

/** The card cannot outlive its shortest predicate: 30 days, not 365. */
export function credentialTtlDays(): number {
  return Math.min(...TWDIW_FIELDS.map((f) => CLAIM_DEFS[f.claimId].ttlDays));
}

/**
 * The four predicate values, keyed by SD-JWT claim name.
 *
 * Same `compute()` the wallet issuer calls (`lib/wallet.ts`), same arguments.
 * Deriving them a second time here is how the two would drift apart.
 */
export function claimValues(state: DemoState, now: Date): Record<string, string> {
  const today = now.toISOString().slice(0, 10);
  const out: Record<string, string> = {};
  for (const { claimId, ename } of TWDIW_FIELDS) {
    out[ename] = CLAIM_DEFS[claimId].compute({
      subject: state.principal.id,
      // No pairwise claim is in this set, so the audience is never consulted;
      // it is passed because `compute` takes it, not because it is used.
      audience: "jia",
      today,
    });
  }
  return out;
}

function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export type TwdiwConfig = {
  enabled: boolean;
  issuerBase: string;
  verifierBase: string;
  vcUid: string;
  vpFullId: string;
  vpPartialId: string;
  apiKey: string;
  apiKeyHeader: string;
  /** Why the sandbox is off, in words the UI can show. Empty when it is on. */
  disabledReason: string;
};

/**
 * The template registered in the sandbox console for this demo.
 *
 * Templates, their fields and the per-field regex can only be created there —
 * there is no API for any of it — so the code is a constant here, not something
 * this process could provision. It is an identifier, not a secret; the api key
 * beside it is the secret.
 */
export const DEMO_VC_UID = "0038403010_childcare_predicates_demo";

/**
 * Authentication is an `Access-Token` header. Not `Authorization: Bearer`, and
 * not `X-API-KEY` — both are the obvious guesses and both get rejected.
 */
export const ISSUER_AUTH_HEADER = "Access-Token";

/**
 * `TWDIW_ENABLED=true` alone is not enough: without an api key there is nothing
 * to authenticate with, so the gap turns the whole section off rather than
 * producing a request that would be rejected at the far end.
 */
export function twdiwConfig(env: Record<string, string | undefined> = process.env): TwdiwConfig {
  const vcUid = env.TWDIW_VC_UID ?? DEMO_VC_UID;
  const apiKeyHeader = env.TWDIW_API_KEY_HEADER ?? ISSUER_AUTH_HEADER;
  const wanted = env.TWDIW_ENABLED === "true";
  const missing: string[] = [];
  if (!wanted) missing.push("TWDIW_ENABLED 不是 true");
  if (!vcUid) missing.push("缺 TWDIW_VC_UID（憑證模板代碼）");
  if (!env.TWDIW_API_KEY) missing.push("缺 TWDIW_API_KEY");
  return {
    enabled: missing.length === 0,
    issuerBase: env.TWDIW_ISSUER_BASE ?? "https://issuer-sandbox.wallet.gov.tw",
    verifierBase: env.TWDIW_VERIFIER_BASE ?? "https://verifier-sandbox.wallet.gov.tw",
    vcUid,
    vpFullId: env.TWDIW_VP_FULL_ID ?? "childcare_full",
    vpPartialId: env.TWDIW_VP_PARTIAL_ID ?? "childcare_partial",
    apiKey: env.TWDIW_API_KEY ?? "",
    apiKeyHeader,
    disabledReason: missing.join("；"),
  };
}

/** A 1×1 PNG. The real sandbox returns the actual QR as a data URI. */
const PLACEHOLDER_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const TICKET_TTL_MS = 5 * 60_000;

/** The page that hands a browser off to the wallet app. */
const DEEPLINK_WRAPPER = "https://frontend-uat.wallet.gov.tw/api/moda/vcqrcode";

/**
 * Offline implementation. Deterministic enough to test, complete enough to run
 * the whole demo with the sandbox switched off.
 */
export class FixtureTwdiw implements TwdiwAdapter {
  private issued = new Map<
    string,
    { claims: Record<string, string>; cid: string; expiresAt: number }
  >();
  private presentations = new Map<
    string,
    { vp: VpProfile; expiresAt: number; polled: boolean }
  >();
  private revoked = new Set<string>();

  constructor(private now: () => Date = () => new Date()) {}

  async issue(claims: Record<string, string>): Promise<IssuanceTicket> {
    const at = this.now();
    const transactionId = randomId("tx");
    const cid = b64u(sha256(utf8(transactionId))).slice(0, 22);
    const expiresAt = at.getTime() + TICKET_TTL_MS;
    this.issued.set(transactionId, { claims, cid, expiresAt });
    return {
      transactionId,
      qrCodeDataUri: PLACEHOLDER_PNG,
      // Same shape as the sandbox's: HTTPS wrapper, base64 payload inside.
      deepLink: `${DEEPLINK_WRAPPER}?data=${b64u(utf8(`modadigitalwallet://credential_offer?transaction_id=${transactionId}`))}`,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async getCredential(transactionId: string): Promise<{ credential: string; cid: string }> {
    const row = this.issued.get(transactionId);
    if (!row) throw new Error(`沒有這筆交易：${transactionId}`);
    const credential = mintSandboxShapedCredential({
      claims: row.claims,
      cid: row.cid,
      now: this.now(),
      ttlDays: credentialTtlDays(),
    });
    return { credential, cid: row.cid };
  }

  async revoke(cid: string): Promise<void> {
    // The sandbox's only action is `revocation`, and it does not come back.
    this.revoked.add(cid);
  }

  isRevoked(cid: string): boolean {
    return this.revoked.has(cid);
  }

  async present(vp: VpProfile): Promise<PresentationTicket> {
    const txId = randomId("vp");
    const expiresAt = this.now().getTime() + TICKET_TTL_MS;
    this.presentations.set(txId, { vp, expiresAt, polled: false });
    return {
      authUri: `modadigitalwallet://oid4vp?request_uri=grantonce.local/vp/${txId}`,
      txId,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async result(txId: string): Promise<PresentationResult> {
    const row = this.presentations.get(txId);
    if (!row) return { status: "failed", reason: "unknown transaction" };
    // A one-shot QR really does expire. Polling past that returns a failure
    // rather than spinning forever.
    if (this.now().getTime() > row.expiresAt) return { status: "failed", reason: "expired" };
    if (!row.polled) {
      row.polled = true;
      return { status: "pending" };
    }
    const all = FIXTURE_PRESENTED;
    const disclosed =
      row.vp === "childcare_full"
        ? { ...all }
        : Object.fromEntries(
            Object.entries(all).filter(([k]) => k !== "movedWithin12m" && k !== "syntheticData"),
          );
    return { status: "done", disclosed };
  }
}

/**
 * What the fixture wallet hands back. Predicate values only — the same four the
 * capsule layer would have released, which is the point.
 */
const FIXTURE_PRESENTED: Record<string, string> = {
  residentInNewTaipei: "true",
  movedWithin12m: "true",
  parentChildVerified: "true",
  childAgeBand: "0-2",
  syntheticData: "true",
};

/**
 * Live sandbox. The three issuer endpoints in §4.1 are confirmed; the two
 * verifier ones (DWVP-101 / DWVP-201) are not published yet, so they throw
 * rather than guess a path. The interface is complete either way, so switching
 * them on later is a body change, not a redesign.
 */
export function issuerHeaders(config: TwdiwConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    [config.apiKeyHeader]: config.apiKey,
  };
}

export class SandboxTwdiw implements TwdiwAdapter {
  constructor(private config: TwdiwConfig = twdiwConfig()) {}

  private headers(): Record<string, string> {
    return issuerHeaders(this.config);
  }

  async issue(claims: Record<string, string>): Promise<IssuanceTicket> {
    const now = new Date();
    const fields = [
      ...TWDIW_FIELDS.map((f) => ({ ename: f.ename, content: claims[f.ename] })),
      { ename: SYNTHETIC_FIELD.ename, content: SYNTHETIC_FIELD.content },
    ];
    // `/qrcode/nodata` takes only a `vcUid` in its schema, so it cannot carry a
    // single one of these values. `/qrcode/data` is the only usable endpoint.
    const response = await fetch(`${this.config.issuerBase}/api/qrcode/data`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        vcUid: this.config.vcUid,
        issuanceDate: yyyymmdd(now),
        expiredDate: yyyymmdd(new Date(now.getTime() + credentialTtlDays() * 86_400_000)),
        fields,
      }),
    });
    if (!response.ok) throw new Error(`發證沙盒回 ${response.status}`);
    const body = (await response.json()) as {
      transactionId: string;
      qrCode: string;
      deepLink: string;
    };
    return {
      transactionId: body.transactionId,
      qrCodeDataUri: body.qrCode,
      deepLink: body.deepLink,
      expiresAt: new Date(now.getTime() + TICKET_TTL_MS).toISOString(),
    };
  }

  async getCredential(transactionId: string): Promise<{ credential: string; cid: string }> {
    const response = await fetch(
      `${this.config.issuerBase}/api/credential/nonce/${encodeURIComponent(transactionId)}`,
      { headers: this.headers() },
    );
    if (!response.ok) throw new Error(`取憑證回 ${response.status}`);
    const body = (await response.json()) as { credential: string };
    return { credential: body.credential, cid: cidFromCredential(body.credential) };
  }

  async revoke(cid: string): Promise<void> {
    // One-way: the action enum has no suspend and no restore.
    const response = await fetch(
      `${this.config.issuerBase}/api/credential/${encodeURIComponent(cid)}/revocation`,
      { method: "PUT", headers: this.headers(), body: JSON.stringify({ action: "revocation" }) },
    );
    if (!response.ok) throw new Error(`撤銷回 ${response.status}`);
  }

  /**
   * DWVP-101. The verifier-side paths are not published yet, so the signature is
   * complete and the body is honest about it — a guessed path would fail at the
   * far end with a message about something else entirely.
   */
  async present(vp: VpProfile): Promise<PresentationTicket> {
    void vp;
    throw new Error("verifier paths TBD");
  }

  /** DWVP-201. Same. */
  async result(txId: string): Promise<PresentationResult> {
    void txId;
    throw new Error("verifier paths TBD");
  }
}

/**
 * `jti` is a URL, not an opaque string: `https://…/api/credential/{cid}`. The
 * CID is the last segment, and it is what the revocation endpoint keys on.
 */
export function cidFromCredential(credential: string): string {
  const payload = credential.split("~")[0].split(".")[1];
  const claims = JSON.parse(new TextDecoder().decode(unb64u(payload))) as { jti?: string };
  const jti = claims.jti ?? "";
  const tail = jti.split("/").filter(Boolean).pop();
  if (!tail) throw new Error("憑證的 jti 裡沒有 cid");
  return tail;
}

export function twdiwAdapter(config: TwdiwConfig = twdiwConfig()): TwdiwAdapter {
  return config.enabled ? new SandboxTwdiw(config) : new FixtureTwdiw();
}

/**
 * The sandbox's own credential shape, minted locally.
 *
 * Signed **ES256** and with `_sd` sitting inside `vc.credentialSubject` rather
 * than at the top — the two things about the real 皮夾 that our own issuer does
 * differently. Without this the interoperability half of `verify()` would have
 * no exercise at all until a live sandbox credential turns up, which is exactly
 * how an untested branch gets shipped.
 */
function fixtureIssuerSecret(): Uint8Array {
  let seed = sha256(utf8("grantonce/twdiw-fixture-issuer"));
  for (let i = 0; i < 8; i++) {
    try {
      p256.getPublicKey(seed);
      return seed;
    } catch {
      seed = sha256(seed);
    }
  }
  throw new Error("無法派生 fixture 的 ES256 金鑰");
}

const FIXTURE_SECRET = fixtureIssuerSecret();

/** Uncompressed P-256 point, base64url — what `verify()` takes as issuer key. */
export function fixtureIssuerPublicKey(): string {
  return b64u(p256.getPublicKey(FIXTURE_SECRET, false));
}

/**
 * Where the sandbox writes `_sd_alg`. The documentation points at three
 * possible levels, so the fixture can produce any of them and `verify()` is
 * expected to cope with all three.
 */
export type SdAlgPlacement = "top" | "vc" | "credentialSubject";

/**
 * A deterministic P-256 holder key, so the fixture credential binds the same
 * shape the wallet does and the ES256 key-binding path has something to run on.
 */
export function fixtureHolderSecret(cid: string): Uint8Array {
  let seed = sha256(utf8(`grantonce/twdiw-fixture-holder/${cid}`));
  for (let i = 0; i < 8; i++) {
    try {
      p256.getPublicKey(seed);
      return seed;
    } catch {
      seed = sha256(seed);
    }
  }
  throw new Error("無法派生 fixture 的持有人金鑰");
}

export function fixtureHolderJwk(cid: string): {
  kty: string;
  crv: string;
  x: string;
  y: string;
} {
  const point = p256.getPublicKey(fixtureHolderSecret(cid), false);
  return {
    kty: "EC",
    crv: "P-256",
    x: b64u(point.subarray(1, 33)),
    y: b64u(point.subarray(33, 65)),
  };
}

export function mintSandboxShapedCredential(input: {
  claims: Record<string, string>;
  cid: string;
  now: Date;
  ttlDays: number;
  sdAlgAt?: SdAlgPlacement;
  /** Defaults to `sha-256`. A different value is how a test proves the field is
   *  actually read at that level rather than defaulted. */
  sdAlgValue?: string;
  holderJwk?: { kty: string; crv: string; x: string; y: string };
}): string {
  const did = "did:web:issuer-sandbox.wallet.gov.tw";
  const iat = Math.floor(input.now.getTime() / 1000);
  const disclosures: string[] = [];
  const digests: string[] = [];

  for (const [name, value] of Object.entries(input.claims)) {
    // Deterministic salt: one transaction always yields the same credential,
    // which is what makes it usable as a fixture.
    const salt = b64u(sha256(utf8(`${input.cid}/${name}`)).subarray(0, 16));
    const encoded = b64u(utf8(JSON.stringify([salt, name, value])));
    disclosures.push(encoded);
    digests.push(sdDigest(encoded));
  }
  digests.sort();

  const header = {
    alg: "ES256",
    // `vc+sd-jwt`, not `dc+sd-jwt`.
    typ: SD_JWT_TYP,
    kid: `${did}#key-1`,
    jku: "https://issuer-sandbox.wallet.gov.tw/.well-known/jwks.json",
  };
  const placement = input.sdAlgAt ?? "top";
  const sdAlg = input.sdAlgValue ?? "sha-256";
  const credentialSubject: Record<string, unknown> = { _sd: digests };
  if (placement === "credentialSubject") credentialSubject._sd_alg = sdAlg;
  const vc: Record<string, unknown> = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential", "ChildcareAllowanceCredential"],
    credentialStatus: {
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "0",
    },
    credentialSchema: { type: "JsonSchema", id: "https://issuer-sandbox.wallet.gov.tw/schema/1" },
    // The digests live here, not at the top level.
    credentialSubject,
  };
  if (placement === "vc") vc._sd_alg = sdAlg;
  const payload: Record<string, unknown> = {
    iss: did,
    sub: `did:example:holder:${input.cid}`,
    nbf: iat,
    exp: iat + Math.round(input.ttlDays * 86_400),
    nonce: b64u(sha256(utf8(`nonce/${input.cid}`)).subarray(0, 12)),
    // A URL, not an opaque string: the CID is its last segment.
    jti: `https://issuer-sandbox.wallet.gov.tw/api/credential/${input.cid}`,
    // EC P-256, because the wallet holds a P-256 key — not the OKP key our own
    // issuer binds. Key binding has to cope with both.
    cnf: { jwk: input.holderJwk ?? fixtureHolderJwk(input.cid) },
    vc,
  };
  if (placement === "top") payload._sd_alg = sdAlg;

  const signingInput = `${b64u(utf8(JSON.stringify(header)))}.${b64u(utf8(JSON.stringify(payload)))}`;
  const signature = p256.sign(sha256(utf8(signingInput)), FIXTURE_SECRET, { prehash: false });
  const jwt = `${signingInput}.${b64u(signature)}`;
  return `${jwt}~${disclosures.map((d) => `${d}~`).join("")}`;
}
