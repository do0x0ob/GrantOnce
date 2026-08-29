"use client";

import { sha256 } from "@noble/hashes/sha2";
import * as ed from "@noble/ed25519";
import { b64u, unb64u, utf8 } from "./crypto";

/**
 * The passkey never signs the grant itself. WebAuthn would only sign an opaque
 * challenge, so instead the PRF extension returns a deterministic secret gated
 * behind Face ID / fingerprint, and that secret derives an ed25519 key whose
 * signed bytes are the readable grant. The private key is never stored: it is
 * re-derived per signature and discarded.
 */

const RP_NAME = "GrantOnce 分匣授權";
const PRF_SALT_TEXT = "grantonce/wallet/v1";
const LS_CRED = "grantonce.credentialId";
const LS_SOFT = "grantonce.softwareSeed";
const LS_PUB = "grantonce.publicKey";

export type WalletKey = {
  publicKey: string;
  method: "passkey" | "software";
  credentialId: string | null;
};

function secretFromPrf(prf: ArrayBuffer): Uint8Array {
  return sha256(new Uint8Array(prf));
}

/**
 * Why a passkey cannot be used here, or null when it can.
 *
 * The RP ID must be a domain: WebAuthn rejects an IP address outright, and only
 * exempts `localhost` from the secure-context requirement. Opening the demo on
 * http://127.0.0.1 therefore fails at `navigator.credentials.create` with a
 * SecurityError — after the button has already promised it would work.
 */
export function originBlocker(
  hostname: string,
  secureContext: boolean,
  port: string,
): string | null {
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  const isIpv6 = hostname.startsWith("[") || hostname.includes(":");
  if (isIpv4 || isIpv6) {
    return `WebAuthn 不接受 IP 位址當 RP ID，請改開 http://localhost:${port || "43127"}`;
  }
  if (!secureContext) return "需要 HTTPS 或 localhost 才能使用 passkey";
  return null;
}

export function passkeyBlocker(): string | null {
  if (typeof window === "undefined") return "尚未載入";
  if (
    typeof window.PublicKeyCredential === "undefined" ||
    typeof navigator.credentials?.create !== "function"
  ) {
    return "這個瀏覽器不支援 passkey";
  }
  return originBlocker(window.location.hostname, window.isSecureContext, window.location.port);
}

export function passkeySupported(): boolean {
  return passkeyBlocker() === null;
}

/**
 * The public key this browser can actually sign with, or null.
 *
 * Presence of *some* key is not enough: the server keeps one registered public
 * key while the private half lives per browser origin, so a different origin or
 * a re-registration elsewhere leaves a wallet that looks ready and then fails at
 * the moment of signing.
 */
export function localPublicKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LS_PUB);
  } catch {
    return null;
  }
}

function rememberPublicKey(key: WalletKey): WalletKey {
  try {
    window.localStorage.setItem(LS_PUB, key.publicKey);
  } catch {
    // private mode; the wallet still works for this page load
  }
  return key;
}

/** WebAuthn wants ArrayBuffer-backed views, not the generic Uint8Array. */
function buf(source: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(source.length));
  out.set(source);
  return out;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(b);
  return b;
}

/** Registers a passkey and derives the wallet key from its PRF output. */
export async function registerPasskey(userName: string): Promise<WalletKey> {
  const blocker = passkeyBlocker();
  if (blocker) throw new Error(blocker);

  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: RP_NAME, id: window.location.hostname },
      user: {
        id: buf(utf8("P-lin-demo")),
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: "preferred",
        // Biometric or PIN, never mere presence.
        userVerification: "required",
      },
      timeout: 60_000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!created) throw new Error("passkey 註冊被取消");

  const ext = created.getClientExtensionResults() as {
    prf?: { enabled?: boolean };
  };
  if (ext.prf?.enabled === false) {
    throw new Error("這個認證器不支援 PRF 擴充，無法派生簽章金鑰");
  }

  const credentialId = b64u(new Uint8Array(created.rawId));
  window.localStorage.setItem(LS_CRED, credentialId);

  // PRF output is only reliably available on an assertion, so take one now.
  const secret = await derivePasskeySecret(credentialId);
  return rememberPublicKey({
    publicKey: b64u(ed.getPublicKey(secret)),
    method: "passkey",
    credentialId,
  });
}

async function derivePasskeySecret(credentialId: string): Promise<Uint8Array> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: window.location.hostname,
      allowCredentials: [{ type: "public-key", id: buf(unb64u(credentialId)) }],
      userVerification: "required",
      timeout: 60_000,
      extensions: {
        prf: { eval: { first: buf(utf8(PRF_SALT_TEXT)) } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error("生物辨識取消");

  const ext = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } };
  };
  const first = ext.prf?.results?.first;
  if (!first) {
    throw new Error("認證器沒有回傳 PRF，無法派生簽章金鑰（請改用軟體金鑰）");
  }
  return secretFromPrf(first);
}

/**
 * Signs the grant. Each signature costs one biometric check, which is the point:
 * approving is a deliberate act, not a background capability the agent holds.
 */
export async function signWithPasskey(message: string): Promise<string> {
  const credentialId = window.localStorage.getItem(LS_CRED);
  if (!credentialId) throw new Error("尚未註冊 passkey");
  const secret = await derivePasskeySecret(credentialId);
  return b64u(ed.sign(utf8(message), secret));
}

/** Fallback for browsers or authenticators without PRF. Clearly weaker. */
export function registerSoftwareKey(): WalletKey {
  let seed = window.localStorage.getItem(LS_SOFT);
  if (!seed) {
    seed = b64u(randomBytes(32));
    window.localStorage.setItem(LS_SOFT, seed);
  }
  const secret = sha256(unb64u(seed));
  return rememberPublicKey({
    publicKey: b64u(ed.getPublicKey(secret)),
    method: "software",
    credentialId: null,
  });
}

export function signWithSoftwareKey(message: string): string {
  const seed = window.localStorage.getItem(LS_SOFT);
  if (!seed) throw new Error("尚未註冊軟體金鑰");
  return b64u(ed.sign(utf8(message), sha256(unb64u(seed))));
}

export async function signGrantBytes(
  method: "passkey" | "software",
  message: string,
): Promise<string> {
  return method === "passkey" ? signWithPasskey(message) : signWithSoftwareKey(message);
}
