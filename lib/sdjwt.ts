/**
 * SD-JWT (RFC 9901) — selective disclosure, one credential, four predicates.
 *
 * This sits *beside* the capsule layer, not inside it. `lib/authz.ts` and
 * `redeemGrant` are untouched: a capsule is still the thing an agency redeems.
 * What this adds is the other half of 「把 MyData 與數位憑證串起來」 — a credential
 * whose holder decides, at presentation time, which of the signed predicates the
 * verifier gets to see, in a format 數位皮夾 can actually read.
 *
 * The one discipline that makes any of it work: a Disclosure is a string, and it
 * is carried, stored and hashed as that exact string. Never a parsed object that
 * gets serialised again. This is the same rule `serializeBody`/`grant.serialized`
 * follow in `lib/crypto.ts` and `lib/authz.ts`, for the same reason — JSON has
 * more than one way to write the same value, and the digest is over the bytes.
 */
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2";
import { b64u, sign as edSign, unb64u, utf8, verify as edVerify } from "./crypto";
import type { IssuerId } from "./claims";
import { ISSUER_KEYS } from "./parties";

/** Explicit typing for what we issue. The sandbox uses the same `typ`. */
export const SD_JWT_TYP = "vc+sd-jwt";
const KB_JWT_TYP = "kb+jwt";
const DEFAULT_SD_ALG = "sha-256";
/** Two, per RFC 9901 §9.7: enough that the count of `_sd` says nothing. */
const DECOY_COUNT = 2;

export type Disclosure = { encoded: string; salt: string; name: string; value: unknown };

export type IssuedSdJwt = {
  /** Issuance form: always ends with `~`. */
  combined: string;
  jwt: string;
  disclosures: Disclosure[];
  /** Sorted, decoys included. */
  sdDigests: string[];
};

export type SdJwtDenyCode =
  | "BAD_FORMAT"
  | "BAD_SIGNATURE"
  | "BAD_ALG"
  | "UNKNOWN_DISCLOSURE"
  | "DUPLICATE_DIGEST"
  | "EXPIRED"
  | "BAD_KB_ALG"
  | "BAD_KB_SIGNATURE"
  | "SD_HASH_MISMATCH"
  | "NONCE_MISMATCH"
  | "AUDIENCE_MISMATCH";

export type VerifyResult =
  | { ok: true; claims: Record<string, unknown>; keyBindingVerified: boolean }
  | { ok: false; code: SdJwtDenyCode; error: string };

/** Carries the deny code out of `issue()`/`present()`, which have no result union. */
export class SdJwtError extends Error {
  constructor(
    readonly code: SdJwtDenyCode,
    message: string,
  ) {
    super(message);
    this.name = "SdJwtError";
  }
}

const decoder = new TextDecoder();

function decodeUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/**
 * The digest of a Disclosure.
 *
 * RFC 9901 §4.2.4.1: taken over the US-ASCII bytes of the base64url-encoded
 * Disclosure, and the bytes of the digest are then base64url-encoded. Both
 * halves are easy to get wrong in the same direction: hashing the *decoded*
 * bytes, or emitting hex, both verify happily against themselves and against
 * nothing else in the world.
 */
export function sdDigest(disclosure: string): string {
  return b64u(sha256(utf8(disclosure)));
}

function b64uJson(value: unknown): string {
  return b64u(utf8(JSON.stringify(value)));
}

function parseJsonB64u(segment: string): unknown {
  return JSON.parse(decodeUtf8(unb64u(segment)));
}

/** `[salt, name, value]`, encoded once. The encoded string is the artefact. */
function makeDisclosure(salt: string, name: string, value: unknown): Disclosure {
  return { encoded: b64uJson([salt, name, value]), salt, name, value };
}

/** Decoded for display only — never re-encoded to compute a digest. */
export function readDisclosure(encoded: string): Disclosure | null {
  try {
    const parts = parseJsonB64u(encoded);
    if (!Array.isArray(parts) || parts.length !== 3) return null;
    const [salt, name, value] = parts as [unknown, unknown, unknown];
    if (typeof salt !== "string" || typeof name !== "string") return null;
    return { encoded, salt, name, value };
  } catch {
    return null;
  }
}

function defaultRng(): Uint8Array {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** 128 bits, base64url. Injectable so the tests can be deterministic. */
function makeSalt(rng: () => Uint8Array): string {
  const bytes = rng();
  if (bytes.length < 16) throw new SdJwtError("BAD_FORMAT", "salt 需要至少 128 bits");
  return b64u(bytes.subarray(0, 16));
}

export function issue(input: {
  claims: Record<string, string>;
  issuer: IssuerId;
  holderPublicKey: string;
  ttlDays: number;
  now: Date;
  rng?: () => Uint8Array;
}): IssuedSdJwt {
  const rng = input.rng ?? defaultRng;
  const disclosures: Disclosure[] = [];

  for (const [name, value] of Object.entries(input.claims)) {
    // RFC 9901 §4.2.1: these two names are the format's own machinery.
    if (name === "_sd" || name === "...") {
      throw new SdJwtError("BAD_FORMAT", `claim name 不可為 ${name}`);
    }
    disclosures.push(makeDisclosure(makeSalt(rng), name, value));
  }

  const digests = disclosures.map((d) => sdDigest(d.encoded));
  // Decoys are the same hash over fresh randomness, so `_sd.length` leaks
  // nothing about how many claims the credential actually carries.
  for (let i = 0; i < DECOY_COUNT; i++) digests.push(sdDigest(makeSalt(rng)));

  const seen = new Set<string>();
  for (const d of digests) {
    if (seen.has(d)) throw new SdJwtError("DUPLICATE_DIGEST", `同一個 digest 出現兩次：${d}`);
    seen.add(d);
  }
  const sdDigests = [...digests].sort();

  const iat = Math.floor(input.now.getTime() / 1000);
  const header = { alg: "EdDSA", typ: SD_JWT_TYP, kid: input.issuer };
  const payload = {
    _sd: sdDigests,
    _sd_alg: DEFAULT_SD_ALG,
    iss: `urn:grantonce:issuer:${input.issuer}`,
    iat,
    exp: iat + Math.round(input.ttlDays * 86_400),
    cnf: { jwk: { kty: "OKP", crv: "Ed25519", x: input.holderPublicKey } },
  };

  const signingInput = `${b64uJson(header)}.${b64uJson(payload)}`;
  const jwt = `${signingInput}.${edSign(signingInput, ISSUER_KEYS[input.issuer].secret)}`;
  const combined = `${jwt}~${disclosures.map((d) => d.encoded).join("~")}${disclosures.length ? "~" : ""}`;

  return { combined, jwt, disclosures, sdDigests };
}

export function present(input: {
  issued: IssuedSdJwt;
  disclose: string[];
  keyBinding?: { aud: string; nonce: string; sign: (b: Uint8Array) => Uint8Array };
}): string {
  const chosen: Disclosure[] = [];
  for (const name of input.disclose) {
    const found = input.issued.disclosures.find((d) => d.name === name);
    if (!found) throw new SdJwtError("UNKNOWN_DISCLOSURE", `沒有發行過這個述詞：${name}`);
    if (chosen.includes(found)) {
      throw new SdJwtError("DUPLICATE_DIGEST", `同一筆 disclosure 出示兩次：${name}`);
    }
    chosen.push(found);
  }

  // Always ends with `~`; the KB-JWT, if any, is appended after it.
  const sdPart = `${input.issued.jwt}~${chosen.map((d) => `${d.encoded}~`).join("")}`;
  if (!input.keyBinding) return sdPart;

  const kbHeader = { alg: "EdDSA", typ: KB_JWT_TYP };
  const kbPayload = {
    iat: Math.floor(Date.now() / 1000),
    aud: input.keyBinding.aud,
    nonce: input.keyBinding.nonce,
    sd_hash: sdHashOf(sdPart),
  };
  const kbSigningInput = `${b64uJson(kbHeader)}.${b64uJson(kbPayload)}`;
  const signature = b64u(input.keyBinding.sign(utf8(kbSigningInput)));
  return `${sdPart}${kbSigningInput}.${signature}`;
}

/** Over everything up to and including the last `~`; the KB-JWT is excluded. */
function sdHashOf(sdPart: string): string {
  return b64u(sha256(utf8(sdPart)));
}

type Split = { jwt: string; disclosures: string[]; kb: string | null };

function isJws(text: string): boolean {
  const parts = text.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

/**
 * `<JWT>~<D1>~…~<Dn>~<KB>` where the KB-JWT may be empty — so a well-formed
 * SD-JWT with no key binding ends with `~`. A string that neither ends with `~`
 * nor carries a JWS in the last slot has had its trailing `~` eaten somewhere,
 * and that is not an SD-JWT.
 */
function splitCombined(combined: string): Split | null {
  const parts = combined.split("~");
  if (parts.length < 2) return null;
  const jwt = parts[0];
  const last = parts[parts.length - 1];
  if (last !== "" && !isJws(last)) return null;
  if (!isJws(jwt)) return null;
  return { jwt, disclosures: parts.slice(1, -1), kb: last === "" ? null : last };
}

function verifyJws(alg: string, signingInput: string, signature: string, key: Uint8Array): boolean {
  if (alg === "EdDSA") return edVerify(signature, signingInput, key);
  if (alg === "ES256") {
    try {
      const raw = unb64u(signature);
      // JWS carries ECDSA as r||s, 32 bytes each — not DER.
      if (raw.length !== 64) return false;
      return p256.verify(raw, sha256(utf8(signingInput)), key, { prehash: false });
    } catch {
      return false;
    }
  }
  return false;
}

/** The whitelist. `none` is not on it, and neither is anything unlisted. */
const SIGNING_ALGS = new Set(["EdDSA", "ES256"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Top level, then `payload.vc`, then `payload.vc.credentialSubject`; absent
 * means SHA-256.
 *
 * RFC 9901 says `_sd_alg` belongs at the top and nowhere else, and that is
 * where we write it. The sandbox's documentation points at three levels, so
 * reading is deliberately more forgiving than writing: refusing a credential
 * over where its issuer put a field we can find would be pedantry with a
 * failed demo attached.
 */
function sdAlgOf(payload: Record<string, unknown>): unknown {
  if ("_sd_alg" in payload) return payload._sd_alg;
  const vc = payload.vc;
  if (isRecord(vc)) {
    if ("_sd_alg" in vc) return vc._sd_alg;
    const subject = vc.credentialSubject;
    if (isRecord(subject) && "_sd_alg" in subject) return subject._sd_alg;
  }
  return DEFAULT_SD_ALG;
}

/**
 * Walks the payload and swaps every `_sd` digest we hold a Disclosure for back
 * into a real claim. The walk is recursive because `_sd` is not required to sit
 * at the top: RFC 9901 puts it inside `address`, and the 數位憑證皮夾 sandbox puts
 * it inside `vc.credentialSubject`.
 *
 * Array-element disclosures (the two-element `{"...": digest}` form) are out of
 * scope here — nothing in this project issues one, so they are left in place
 * rather than half-resolved.
 */
function resolveClaims(
  node: unknown,
  byDigest: Map<string, Disclosure>,
  used: Set<string>,
): unknown {
  if (Array.isArray(node)) return node.map((item) => resolveClaims(item, byDigest, used));
  if (!isRecord(node)) return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "_sd" || key === "_sd_alg") continue;
    out[key] = resolveClaims(value, byDigest, used);
  }
  const sd = node._sd;
  if (Array.isArray(sd)) {
    for (const digest of sd) {
      if (typeof digest !== "string") continue;
      const disclosure = byDigest.get(digest);
      if (!disclosure) continue; // a decoy, or a claim this presentation withheld
      used.add(digest);
      out[disclosure.name] = resolveClaims(disclosure.value, byDigest, used);
    }
  }
  return out;
}

function deny(code: SdJwtDenyCode, error: string): VerifyResult {
  return { ok: false, code, error };
}

export function verify(input: {
  combined: string;
  issuerPublicKey: string;
  now: Date;
  expect?: { aud: string; nonce: string };
}): VerifyResult {
  const split = splitCombined(input.combined);
  if (!split) return deny("BAD_FORMAT", "不是合法的 SD-JWT（缺尾端 ~ 或結構不對）");

  const [h, p, s] = split.jwt.split(".");
  let header: unknown;
  try {
    header = parseJsonB64u(h);
  } catch {
    return deny("BAD_FORMAT", "JWS header 解不開");
  }
  if (!isRecord(header)) return deny("BAD_FORMAT", "JWS header 不是物件");

  const alg = header.alg;
  // The algorithm picks the verification function and nothing else. The key is
  // the caller's; letting the header choose it is the algorithm-confusion hole.
  if (typeof alg !== "string" || !SIGNING_ALGS.has(alg)) {
    return deny("BAD_ALG", `不在白名單內的 alg：${String(alg)}`);
  }

  let issuerKey: Uint8Array;
  try {
    issuerKey = unb64u(input.issuerPublicKey);
  } catch {
    return deny("BAD_SIGNATURE", "發證方公鑰解不開");
  }
  if (!verifyJws(alg, `${h}.${p}`, s, issuerKey)) {
    return deny("BAD_SIGNATURE", "發證方簽章驗不過");
  }

  let payload: unknown;
  try {
    payload = parseJsonB64u(p);
  } catch {
    return deny("BAD_FORMAT", "JWS payload 解不開");
  }
  if (!isRecord(payload)) return deny("BAD_FORMAT", "JWS payload 不是物件");

  const sdAlg = sdAlgOf(payload);
  if (sdAlg !== DEFAULT_SD_ALG) return deny("BAD_ALG", `不支援的 _sd_alg：${String(sdAlg)}`);

  const exp = payload.exp;
  if (typeof exp === "number" && exp * 1000 <= input.now.getTime()) {
    return deny("EXPIRED", "憑證已過期");
  }

  const byDigest = new Map<string, Disclosure>();
  for (const raw of split.disclosures) {
    // Hashed exactly as it arrived. Re-serialising a parsed disclosure is the
    // same mistake `grant.serialized` exists to prevent, one layer up.
    const dg = sdDigest(raw);
    if (byDigest.has(dg)) return deny("DUPLICATE_DIGEST", `同一筆 disclosure 附了兩次：${dg}`);
    const parsed = readDisclosure(raw);
    if (!parsed) return deny("BAD_FORMAT", "disclosure 不是 [salt, name, value]");
    byDigest.set(dg, parsed);
  }

  const used = new Set<string>();
  const claims = resolveClaims(payload, byDigest, used) as Record<string, unknown>;
  if (used.size !== byDigest.size) {
    return deny("UNKNOWN_DISCLOSURE", "有 disclosure 的 digest 不在 _sd 裡");
  }

  if (!split.kb) {
    if (input.expect) return deny("BAD_FORMAT", "要求 key binding，但出示內容沒有 KB-JWT");
    return { ok: true, claims, keyBindingVerified: false };
  }

  const kb = verifyKeyBinding({
    kb: split.kb,
    sdPart: input.combined.slice(0, input.combined.length - split.kb.length),
    payload,
    expect: input.expect,
  });
  if (kb) return kb;
  return { ok: true, claims, keyBindingVerified: true };
}

/** Returns a denial, or null when the key binding checks out. */
function verifyKeyBinding(input: {
  kb: string;
  sdPart: string;
  payload: Record<string, unknown>;
  expect?: { aud: string; nonce: string };
}): VerifyResult | null {
  const [h, p, s] = input.kb.split(".");
  let header: unknown;
  let payload: unknown;
  try {
    header = parseJsonB64u(h);
    payload = parseJsonB64u(p);
  } catch {
    // A KB-specific code, not BAD_FORMAT: the SD-JWT's own shape was fine, and
    // conflating the two would let a truncated presentation — one whose last
    // Disclosure got read as a KB-JWT — come back wearing the same code as a
    // properly rejected one.
    return deny("BAD_KB_ALG", "KB-JWT 解不開，讀不到 alg");
  }
  if (!isRecord(header) || !isRecord(payload)) return deny("BAD_KB_ALG", "KB-JWT 不是物件");
  if (header.typ !== KB_JWT_TYP) return deny("BAD_KB_ALG", `KB-JWT 的 typ 不是 ${KB_JWT_TYP}`);
  if (typeof header.alg !== "string" || !SIGNING_ALGS.has(header.alg)) {
    return deny("BAD_KB_ALG", `KB-JWT 的 alg 不可為 ${String(header.alg)}`);
  }

  // The holder key comes from the credential the issuer signed, never from the
  // KB-JWT itself — otherwise anyone could bring their own key and their own proof.
  // The holder key comes from the credential the issuer signed, and its own
  // `kty`/`crv` decide which algorithm may sign against it. Our issuer binds an
  // Ed25519 key; the 皮夾 binds EC P-256. Both are real, so both are here.
  const cnf = input.payload.cnf;
  const jwk = isRecord(cnf) ? cnf.jwk : undefined;
  const holder = isRecord(jwk) ? holderKeyFrom(jwk) : null;
  if (!holder) return deny("BAD_KB_SIGNATURE", "憑證裡沒有認得出來的 cnf.jwk，無從驗持有證明");
  // Matching them is the point: a KB-JWT claiming EdDSA over an EC holder key
  // is the algorithm-confusion move, and it has to be refused before any
  // verification is attempted rather than merely failing to verify.
  if (header.alg !== holder.alg) {
    return deny("BAD_KB_ALG", `KB-JWT 宣告 ${String(header.alg)}，但 cnf.jwk 是 ${holder.alg} 的金鑰`);
  }
  if (!verifyJws(holder.alg, `${h}.${p}`, s, holder.key)) {
    return deny("BAD_KB_SIGNATURE", "KB-JWT 簽章驗不過");
  }

  if (payload.sd_hash !== sdHashOf(input.sdPart)) {
    return deny("SD_HASH_MISMATCH", "sd_hash 與實際出示的內容對不上");
  }
  if (input.expect) {
    if (payload.nonce !== input.expect.nonce) return deny("NONCE_MISMATCH", "nonce 不符");
    if (payload.aud !== input.expect.aud) return deny("AUDIENCE_MISMATCH", "aud 不符");
  }
  return null;
}

type HolderKey = { key: Uint8Array; alg: "EdDSA" | "ES256" };

/**
 * Reads the holder key out of `cnf.jwk`, and reports which algorithm that key
 * can be verified with. The JWK's own `kty`/`crv` decide; the KB-JWT header
 * gets no say in it.
 */
function holderKeyFrom(jwk: Record<string, unknown>): HolderKey | null {
  const { kty, crv, x, y } = jwk;
  if (typeof x !== "string") return null;
  try {
    if (kty === "OKP" && crv === "Ed25519") return { key: unb64u(x), alg: "EdDSA" };
    if (kty === "EC" && crv === "P-256" && typeof y === "string") {
      return { key: p256PublicKeyFromJwk({ x, y }), alg: "ES256" };
    }
  } catch {
    return null;
  }
  return null;
}

/** P-256 JWK → the uncompressed point `@noble/curves` verifies against. */
export function p256PublicKeyFromJwk(jwk: { x: string; y: string }): Uint8Array {
  const x = unb64u(jwk.x);
  const y = unb64u(jwk.y);
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(x, 33 - x.length);
  out.set(y, 65 - y.length);
  return out;
}
