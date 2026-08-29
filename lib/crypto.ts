import * as ed from "@noble/ed25519";
import { hmac } from "@noble/hashes/hmac";
import { sha256, sha512 } from "@noble/hashes/sha2";

// noble-ed25519 v2 needs an explicit sync hash to expose sign/verify/getPublicKey.
if (!ed.etc.sha512Sync) {
  ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** base64url, unpadded. */
export function b64u(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const c = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64URL[a >> 2];
    out += B64URL[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += B64URL[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += B64URL[c & 63];
  }
  return out;
}

export function unb64u(text: string): Uint8Array {
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (const ch of clean) {
    const v = B64URL.indexOf(ch);
    if (v < 0) throw new Error(`base64url 含非法字元：${ch}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

const enc = new TextEncoder();

export function utf8(text: string): Uint8Array {
  return enc.encode(text);
}

/**
 * The bytes that actually get signed.
 *
 * Keys are sorted recursively so the same body always produces the same string.
 * Deliberately NOT a JSON canonicalisation scheme: callers serialise once, carry
 * that exact string, and hash the string. Re-serialising a parsed object is the
 * classic way to end up with two different hashes for one grant.
 *
 * Do not be tempted back to `JSON.stringify(body, sortedKeys)`. The array form
 * of the replacer filters *every* object in the tree by that one key list, so a
 * nested `cnf: { jkt }` silently serialises as `{}` and drops out of the
 * signature.
 */
export function serializeBody(body: unknown): string {
  return JSON.stringify(sortDeep(body));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortDeep((value as Record<string, unknown>)[key]);
  }
  return out;
}

export function digest(serialized: string): string {
  return b64u(sha256(utf8(serialized)));
}

export type KeyPair = { secret: Uint8Array; publicKey: Uint8Array; jkt: string };

/** JWK-style thumbprint of an ed25519 public key. Used as the `cnf.jkt` binding. */
export function thumbprint(publicKey: Uint8Array): string {
  const jwk = `{"crv":"Ed25519","kty":"OKP","x":"${b64u(publicKey)}"}`;
  return b64u(sha256(utf8(jwk)));
}

/** Deterministic keys from a label so a demo restart keeps the same identities. */
export function keyPairFromSeed(seed: Uint8Array | string): KeyPair {
  const secret =
    typeof seed === "string" ? sha256(utf8(`grantonce/key/${seed}`)) : seed.slice(0, 32);
  const publicKey = ed.getPublicKey(secret);
  return { secret, publicKey, jkt: thumbprint(publicKey) };
}

export function sign(message: string, secret: Uint8Array): string {
  return b64u(ed.sign(utf8(message), secret));
}

export function verify(signature: string, message: string, publicKey: Uint8Array): boolean {
  try {
    return ed.verify(unb64u(signature), utf8(message), publicKey);
  } catch {
    return false;
  }
}

/**
 * Key behind the pairwise pseudonyms.
 *
 * Unkeyed hashing would not do: identifiers come from a small enumerable space,
 * so anyone could recompute every agency's pseudonym for a guessed subject and
 * join the agencies' records back together. The fallback below is a fixed demo
 * value — deterministic so the web app and the MCP server agree and a restart
 * keeps existing credentials valid. A real deployment sets
 * GRANTONCE_PAIRWISE_SECRET and keeps it off disk.
 */
const PAIRWISE_SECRET = utf8(
  process.env.GRANTONCE_PAIRWISE_SECRET ?? "grantonce-demo-pairwise-key",
);

/**
 * Pairwise pseudonym: agency 甲 and agency 乙 receive different identifiers for
 * the same person, so joining their databases cannot rebuild a single profile.
 */
export function pairwiseId(subject: string, audience: string): string {
  const mac = hmac(sha256, PAIRWISE_SECRET, utf8(`${audience}\u0000${subject}`));
  return `PP-${b64u(mac).slice(0, 16)}`;
}

export function randomId(prefix: string): string {
  const bytes = new Uint8Array(9);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `${prefix}_${b64u(bytes)}`;
}
