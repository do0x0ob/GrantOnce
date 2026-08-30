/**
 * SD-JWT (RFC 9901) checks. Run with `npm run test:sdjwt`.
 *
 * The two assertions everything else rests on are in 互通: the digest of a
 * Disclosure is taken over the US-ASCII bytes of the base64url string exactly as
 * it arrived, and the string is never re-serialised on the way. Get either wrong
 * and the library still verifies its own output perfectly — and nothing else in
 * the world. That is why the RFC's own appendix vectors are in here rather than
 * a round-trip against ourselves.
 */
import { existsSync, readFileSync } from "node:fs";
import * as ed from "@noble/ed25519";
import { b64u, keyPairFromSeed, serializeBody, unb64u, utf8 } from "../lib/crypto";
import { ISSUER_KEYS } from "../lib/parties";
import { CLAIM_DEFS } from "../lib/claims";
import { issue, p256PublicKeyFromJwk, present, sdDigest, verify } from "../lib/sdjwt";
import type { IssuedSdJwt } from "../lib/sdjwt";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2";
import {
  claimValues,
  credentialTtlDays,
  DEMO_VC_UID,
  DEMO_VP_FULL_REF,
  DEMO_VP_PARTIAL_REF,
  FixtureTwdiw,
  fixtureHolderSecret,
  fixtureIssuerPublicKey,
  ISSUER_AUTH_HEADER,
  mintSandboxShapedCredential,
  SandboxTwdiw,
  twdiwAdapter,
  twdiwConfig,
  TWDIW_FIELDS,
  type SdAlgPlacement,
} from "../lib/twdiw";
import { getState, resetState } from "../lib/store";

let pass = 0;
const failures: string[] = [];
const skipped: string[] = [];
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name} ${extra}`);
  }
}
function skip(name: string, why: string) {
  skipped.push(name);
  console.log(`  skip ${name}（${why}）`);
}
function section(title: string) {
  console.log(`\n${title}`);
}

const decoder = new TextDecoder();
const holder = keyPairFromSeed("test-holder-sdjwt");
const stranger = keyPairFromSeed("test-stranger-sdjwt");
const holderPublicKey = b64u(holder.publicKey);
const issuerPublicKey = b64u(ISSUER_KEYS["household-office"].publicKey);

/** Counter-based, so 「同樣輸入與 rng 產生同樣輸出」 is a claim we can make. */
function fixedRng(seed: string): () => Uint8Array {
  let n = 0;
  return () => {
    const bytes = new Uint8Array(16);
    const src = utf8(`${seed}/${n++}`);
    for (let i = 0; i < 16; i++) bytes[i] = (src[i % src.length] * (i + 7) + n * 31) & 0xff;
    return bytes;
  };
}

const CLAIMS = {
  residentInNewTaipei: "true",
  movedWithin12m: "true",
  parentChildVerified: "true",
  childAgeBand: "0-2",
};
const NOW = new Date("2026-08-30T00:00:00Z");

function mint(rngSeed = "seed-a"): IssuedSdJwt {
  return issue({
    claims: CLAIMS,
    issuer: "household-office",
    holderPublicKey,
    ttlDays: 30,
    now: NOW,
    rng: fixedRng(rngSeed),
  });
}

/** Segment 1 is the payload; pass 0 for the header. */
function payloadOf(jwt: string, segment = 1): Record<string, unknown> {
  return JSON.parse(decoder.decode(unb64u(jwt.split(".")[segment])));
}

function jwsOf(header: unknown, payload: unknown, secret: Uint8Array): string {
  const signingInput = `${b64u(utf8(JSON.stringify(header)))}.${b64u(utf8(JSON.stringify(payload)))}`;
  return `${signingInput}.${b64u(ed.sign(utf8(signingInput), secret))}`;
}

function codeOf(result: ReturnType<typeof verify>): string {
  return result.ok ? "ok" : result.code;
}

section("發證");
{
  const issued = mint();
  check("組合格式以 ~ 結尾", issued.combined.endsWith("~"), issued.combined.slice(-40));

  const raw = decoder.decode(unb64u(issued.jwt.split(".")[1]));
  const leaks = [...Object.keys(CLAIMS), ...Object.values(CLAIMS)].filter((t) => raw.includes(t));
  check("payload 不含任何述詞名稱或值的明文", leaks.length === 0, leaks.join(","));

  const sorted = [...issued.sdDigests].sort();
  const unique = new Set(issued.sdDigests);
  check(
    "_sd 已排序且無重複",
    issued.sdDigests.join() === sorted.join() && unique.size === issued.sdDigests.length,
  );
  check("_sd 筆數等於述詞數加 decoy 數", issued.sdDigests.length === 4 + 2, String(issued.sdDigests.length));
  check("同樣輸入與 rng 產生同樣輸出", mint().combined === issued.combined);
}

section("出示與驗證");
{
  const issued = mint();
  const all = present({ issued, disclose: Object.keys(CLAIMS) });
  const full = verify({ combined: all, issuerPublicKey, now: NOW });
  check(
    "全揭露四題，驗得過，四個值都拿得到",
    full.ok && Object.keys(CLAIMS).every((k) => full.claims[k] === CLAIMS[k as keyof typeof CLAIMS]),
    codeOf(full),
  );

  const two = present({ issued, disclose: ["residentInNewTaipei", "childAgeBand"] });
  const partial = verify({ combined: two, issuerPublicKey, now: NOW });
  check(
    "只揭露兩題，仍驗得過，且只拿得到兩個值",
    partial.ok &&
      partial.claims.residentInNewTaipei === "true" &&
      partial.claims.childAgeBand === "0-2" &&
      !("movedWithin12m" in partial.claims) &&
      !("parentChildVerified" in partial.claims),
    codeOf(partial),
  );
  check("出示兩題的組合字串嚴格短於出示四題", two.length < all.length, `${two.length} < ${all.length}`);

  const foreign = mint("seed-b").disclosures[0].encoded;
  const withForeign = verify({ combined: `${all}${foreign}~`, issuerPublicKey, now: NOW });
  check("附上未發行的 disclosure → UNKNOWN_DISCLOSURE", codeOf(withForeign) === "UNKNOWN_DISCLOSURE", codeOf(withForeign));

  const original = issued.disclosures[0];
  const tampered = b64u(utf8(JSON.stringify([original.salt, original.name, "false"])));
  const withTampered = verify({
    combined: all.replace(original.encoded, tampered),
    issuerPublicKey,
    now: NOW,
  });
  check("竄改 disclosure 的值 → UNKNOWN_DISCLOSURE", codeOf(withTampered) === "UNKNOWN_DISCLOSURE", codeOf(withTampered));

  const [h, , s] = issued.jwt.split(".");
  const swapped = { ...payloadOf(issued.jwt), iss: "urn:grantonce:issuer:tax" };
  const forged = all.replace(issued.jwt, `${h}.${b64u(utf8(JSON.stringify(swapped)))}.${s}`);
  const badSig = verify({ combined: forged, issuerPublicKey, now: NOW });
  check("竄改 JWT payload → BAD_SIGNATURE", codeOf(badSig) === "BAD_SIGNATURE", codeOf(badSig));

  const trimmed = verify({ combined: all.slice(0, -1), issuerPublicKey, now: NOW });
  check("拿掉尾端 ~ → BAD_FORMAT", codeOf(trimmed) === "BAD_FORMAT", codeOf(trimmed));

  const doubled = verify({
    combined: `${all}${issued.disclosures[0].encoded}~`,
    issuerPublicKey,
    now: NOW,
  });
  check("同一筆 disclosure 附兩次 → DUPLICATE_DIGEST", codeOf(doubled) === "DUPLICATE_DIGEST", codeOf(doubled));

  const shortLived = issue({
    claims: CLAIMS,
    issuer: "household-office",
    holderPublicKey,
    ttlDays: 1,
    now: NOW,
    rng: fixedRng("seed-exp"),
  });
  const expired = verify({
    combined: shortLived.combined,
    issuerPublicKey,
    now: new Date(NOW.getTime() + 2 * 86_400_000),
  });
  check("過期 → EXPIRED", codeOf(expired) === "EXPIRED", codeOf(expired));

  // `none` with a signature present, so the whitelist is what rejects it rather
  // than the shape check upstream of it.
  const noneHeader = b64u(utf8(JSON.stringify({ alg: "none", typ: "vc+sd-jwt" })));
  const noneJwt = `${noneHeader}.${issued.jwt.split(".")[1]}.${s}`;
  const badAlg = verify({ combined: `${noneJwt}~`, issuerPublicKey, now: NOW });
  check("alg 不在白名單 → BAD_ALG", codeOf(badAlg) === "BAD_ALG", codeOf(badAlg));
}

section("Key Binding");
{
  const issued = mint();
  const AUD = "https://verifier.example.org";
  const NONCE = "nonce-1234567890";
  const expect = { aud: AUD, nonce: NONCE };
  const names = Object.keys(CLAIMS);

  const bound = present({
    issued,
    disclose: names,
    keyBinding: { aud: AUD, nonce: NONCE, sign: (b) => ed.sign(b, holder.secret) },
  });
  const good = verify({ combined: bound, issuerPublicKey, now: NOW, expect });
  check("正確的 KB-JWT → keyBindingVerified 為 true", good.ok && good.keyBindingVerified, codeOf(good));

  const sdPart = bound.slice(0, bound.lastIndexOf("~") + 1);
  const kbPayload = JSON.parse(decoder.decode(unb64u(bound.split("~").pop()!.split(".")[1])));

  function rebind(patch: Record<string, unknown>, header = { alg: "EdDSA", typ: "kb+jwt" }, key = holder.secret) {
    return `${sdPart}${jwsOf(header, { ...kbPayload, ...patch }, key)}`;
  }

  const wrongHash = verify({ combined: rebind({ sd_hash: sdDigest("not-the-presentation") }), issuerPublicKey, now: NOW, expect });
  check("sd_hash 對不上 → SD_HASH_MISMATCH", codeOf(wrongHash) === "SD_HASH_MISMATCH", codeOf(wrongHash));

  const wrongNonce = verify({ combined: rebind({ nonce: "other" }), issuerPublicKey, now: NOW, expect });
  check("nonce 不符 → NONCE_MISMATCH", codeOf(wrongNonce) === "NONCE_MISMATCH", codeOf(wrongNonce));

  const wrongAud = verify({ combined: rebind({ aud: "https://elsewhere.example" }), issuerPublicKey, now: NOW, expect });
  check("aud 不符 → AUDIENCE_MISMATCH", codeOf(wrongAud) === "AUDIENCE_MISMATCH", codeOf(wrongAud));

  const wrongTyp = verify({ combined: rebind({}, { alg: "EdDSA", typ: "JWT" }), issuerPublicKey, now: NOW, expect });
  check("typ 不是 kb+jwt → BAD_KB_ALG", codeOf(wrongTyp) === "BAD_KB_ALG", codeOf(wrongTyp));

  const noneAlg = verify({ combined: rebind({}, { alg: "none", typ: "kb+jwt" }), issuerPublicKey, now: NOW, expect });
  check("alg 是 none → BAD_KB_ALG", codeOf(noneAlg) === "BAD_KB_ALG", codeOf(noneAlg));

  const strangerSigned = verify({ combined: rebind({}, { alg: "EdDSA", typ: "kb+jwt" }, stranger.secret), issuerPublicKey, now: NOW, expect });
  check("用別人的金鑰簽 KB → BAD_KB_SIGNATURE", codeOf(strangerSigned) === "BAD_KB_SIGNATURE", codeOf(strangerSigned));

  const noKb = verify({ combined: present({ issued, disclose: names }), issuerPublicKey, now: NOW, expect });
  check("要求 key binding 卻沒附 KB-JWT → 拒絕", !noKb.ok, codeOf(noKb));

  // The 皮夾 binds an EC P-256 key, so the KB-JWT that comes back is ES256.
  // Our own credential binds Ed25519. Both have to work, and neither may be
  // allowed to sign for the other.
  const cid = "kb-es256";
  const holderSecret = fixtureHolderSecret(cid);
  const sandbox = mintSandboxShapedCredential({
    claims: CLAIMS,
    cid,
    now: NOW,
    ttlDays: 30,
  });
  const sandboxKey = fixtureIssuerPublicKey();

  function bindEs256(header: Record<string, unknown>, patch: Record<string, unknown> = {}) {
    const kbPayload = {
      iat: Math.floor(NOW.getTime() / 1000),
      aud: AUD,
      nonce: NONCE,
      sd_hash: sdDigest(sandbox),
      ...patch,
    };
    const signingInput = `${b64u(utf8(JSON.stringify(header)))}.${b64u(utf8(JSON.stringify(kbPayload)))}`;
    const sig = p256.sign(sha256(utf8(signingInput)), holderSecret, { prehash: false });
    return `${sandbox}${signingInput}.${b64u(sig)}`;
  }

  const es256Kb = verify({
    combined: bindEs256({ alg: "ES256", typ: "kb+jwt" }),
    issuerPublicKey: sandboxKey,
    now: NOW,
    expect,
  });
  check(
    "皮夾的 EC P-256 cnf.jwk：ES256 的 KB-JWT 驗得過",
    es256Kb.ok && es256Kb.keyBindingVerified,
    codeOf(es256Kb),
  );

  const confused = verify({
    combined: bindEs256({ alg: "EdDSA", typ: "kb+jwt" }),
    issuerPublicKey: sandboxKey,
    now: NOW,
    expect,
  });
  check(
    "cnf.jwk 是 EC 卻宣告 EdDSA → BAD_KB_ALG（演算法混淆）",
    codeOf(confused) === "BAD_KB_ALG",
    codeOf(confused),
  );

  const wrongHolder = verify({
    combined: `${sandbox}${jwsOf({ alg: "EdDSA", typ: "kb+jwt" }, { iat: 0, aud: AUD, nonce: NONCE, sd_hash: sdDigest(sandbox) }, holder.secret)}`,
    issuerPublicKey: sandboxKey,
    now: NOW,
    expect,
  });
  check(
    "拿自己的 ed25519 金鑰去簽皮夾憑證的 KB → 擋下",
    !wrongHolder.ok,
    codeOf(wrongHolder),
  );
}

section("互通");
{
  const path = "test/fixtures/rfc9901-simple-structured.json";
  const fx = JSON.parse(readFileSync(path, "utf8")) as {
    issuerPublicKeyJwk: { x: string; y: string };
    issuance: string;
    presentation: string;
    verifiedPresentation: Record<string, unknown>;
    disclosureDigests: { disclosure: string; digest: string }[];
  };
  const rfcKey = b64u(p256PublicKeyFromJwk(fx.issuerPublicKeyJwk));
  const at = new Date("2026-08-30T00:00:00Z");

  const wrong = fx.disclosureDigests.filter((d) => sdDigest(d.disclosure) !== d.digest);
  check("RFC 9901 附錄向量的 digest 一字不差", wrong.length === 0, `${wrong.length} 筆對不上`);

  const issuance = verify({ combined: fx.issuance, issuerPublicKey: rfcKey, now: at });
  check("verify() 驗得過 RFC 9901 附錄的範例向量", issuance.ok, codeOf(issuance));

  const presentation = verify({ combined: fx.presentation, issuerPublicKey: rfcKey, now: at });
  check(
    "RFC 向量只出示兩題時，還原內容與 verified_contents 逐欄相同",
    presentation.ok && serializeBody(presentation.claims) === serializeBody(fx.verifiedPresentation),
    codeOf(presentation),
  );

  // A credential the real sandbox issued, straight out of
  // `GET /api/credential/nonce/{transactionId}`, with the issuer's public key
  // beside it. This is the only assertion in the file that proves we read what
  // the 數位憑證皮夾 actually writes, rather than what we think it writes.
  const CREDENTIAL_FILE = "test/fixtures/sandbox-sdjwt.txt";
  const JWK_FILE = "test/fixtures/sandbox-issuer-jwk.json";
  if (!existsSync(CREDENTIAL_FILE) || !existsSync(JWK_FILE)) {
    const missing = [CREDENTIAL_FILE, JWK_FILE].filter((f) => !existsSync(f));
    skip("verify() 驗得過真的沙盒憑證", `尚未提供 ${missing.join(" 與 ")}`);
  } else {
    const combined = readFileSync(CREDENTIAL_FILE, "utf8").trim();
    const raw = JSON.parse(readFileSync(JWK_FILE, "utf8")) as
      | { x: string; y: string; kid?: string }
      | { keys: { x: string; y: string; kid?: string; kty?: string; crv?: string }[] };
    const header = payloadOf(combined.split("~")[0], 0) as { kid?: string; alg?: string };
    const jwk =
      "keys" in raw
        ? (raw.keys.find((k) => k.kid === header.kid) ??
          raw.keys.find((k) => k.kty === "EC" && k.crv === "P-256") ??
          raw.keys[0])
        : raw;
    const key = b64u(p256PublicKeyFromJwk(jwk));

    check("沙盒憑證簽的是 ES256", header.alg === "ES256", String(header.alg));

    // Verified inside its own validity window: a card issued weeks before the
    // demo would otherwise fail on EXPIRED and tell us nothing about the parts
    // this assertion exists for.
    const body = payloadOf(combined.split("~")[0]) as { nbf?: number; iat?: number };
    const anchorSeconds = body.nbf ?? body.iat ?? Math.floor(Date.now() / 1000);
    const at = new Date((anchorSeconds + 60) * 1000);
    const result = verify({ combined, issuerPublicKey: key, now: at });
    check("verify() 驗得過真的沙盒憑證", result.ok, codeOf(result));

    if (result.ok) {
      const flat = JSON.stringify(result.claims);
      const found = TWDIW_FIELDS.filter((f) => flat.includes(f.ename));
      check(
        "四個述詞的 ename 都在還原出來的內容裡",
        found.length === TWDIW_FIELDS.length,
        `找到 ${found.map((f) => f.ename).join("、") || "（無）"}`,
      );
    }
    const live = verify({ combined, issuerPublicKey: key, now: new Date() });
    if (!live.ok && live.code === "EXPIRED") {
      console.log("       （這張沙盒憑證今天已經過期，簽章與結構仍然驗過）");
    }
  }
}

async function sandboxSection() {
  section("沙盒 adapter");
  resetState();
  const state = getState();
  const config = twdiwConfig({});
  check("沒有環境變數時沙盒是停用的", !config.enabled && config.disabledReason.length > 0, config.disabledReason);
  check(
    "TWDIW_ENABLED=true 但缺 api key 仍是停用",
    !twdiwConfig({ TWDIW_ENABLED: "true" }).enabled,
  );
  check(
    "把 vcUid 明確清空也是停用（沒有模板就沒有東西可發）",
    !twdiwConfig({ TWDIW_ENABLED: "true", TWDIW_API_KEY: "k", TWDIW_VC_UID: "" }).enabled,
  );

  const values = claimValues(state, NOW);
  const direct = Object.fromEntries(
    TWDIW_FIELDS.map((f) => [
      f.ename,
      CLAIM_DEFS[f.claimId].compute({
        subject: state.principal.id,
        audience: "jia",
        today: NOW.toISOString().slice(0, 10),
      }),
    ]),
  );
  check("四個述詞的值來自 CLAIM_DEFS.compute，沒有第二份算法", serializeBody(values) === serializeBody(direct));
  check("卡片效期取四個述詞 ttlDays 的最小值", credentialTtlDays() === 30, String(credentialTtlDays()));

  const wallet = new FixtureTwdiw(() => NOW);
  const ticket = await wallet.issue({ ...values, syntheticData: "true" });
  check(
    "發證票的 QR 是 data URI PNG，不用自己畫",
    ticket.qrCodeDataUri.startsWith("data:image/png;base64,"),
  );
  check(
    "deepLink 是 HTTPS 包裝，內層才是 modadigitalwallet://",
    ticket.deepLink.startsWith("https://frontend-uat.wallet.gov.tw/api/moda/vcqrcode?") &&
      decoder
        .decode(unb64u(new URL(ticket.deepLink).searchParams.get("data") ?? ""))
        .startsWith("modadigitalwallet://"),
    ticket.deepLink,
  );
  check("發證票會過期", new Date(ticket.expiresAt).getTime() > NOW.getTime());

  const { credential, cid } = await wallet.getCredential(ticket.transactionId);
  const shaped = verify({ combined: credential, issuerPublicKey: fixtureIssuerPublicKey(), now: NOW });
  check(
    "沙盒形狀（ES256 簽章、_sd 在 vc.credentialSubject 裡）驗得過",
    shaped.ok && isRecord(shaped.claims.vc) && isRecord(shaped.claims.vc.credentialSubject),
    codeOf(shaped),
  );
  if (shaped.ok && isRecord(shaped.claims.vc) && isRecord(shaped.claims.vc.credentialSubject)) {
    const subject = shaped.claims.vc.credentialSubject;
    check(
      "沙盒憑證還原得出四個述詞的值",
      TWDIW_FIELDS.every((f) => subject[f.ename] === values[f.ename]),
      JSON.stringify(subject),
    );
  }
  const jti = String((payloadOf(credential.split("~")[0]) as { jti?: string }).jti ?? "");
  check("cid 取自 jti 這個 URL 的尾段", jti.endsWith(`/${cid}`), jti);
  check(
    "沙盒憑證的 typ 是 vc+sd-jwt，不是 dc+sd-jwt",
    (payloadOf(credential.split("~")[0], 0) as { typ?: string }).typ === "vc+sd-jwt",
  );

  // The sandbox documentation points at three levels for `_sd_alg`, so all
  // three have to resolve rather than only the one RFC 9901 mandates.
  for (const at of ["top", "vc", "credentialSubject"] as SdAlgPlacement[]) {
    const moved = mintSandboxShapedCredential({
      claims: values,
      cid: `sdalg-${at}`,
      now: NOW,
      ttlDays: 30,
      sdAlgAt: at,
    });
    const result = verify({ combined: moved, issuerPublicKey: fixtureIssuerPublicKey(), now: NOW });
    check(`_sd_alg 放在 ${at} 也找得到`, result.ok, codeOf(result));

    // Reading it is not the same as defaulting to it: an unsupported value at
    // that level has to be refused, or「三個位置都找」is a comment, not code.
    const bogus = mintSandboxShapedCredential({
      claims: values,
      cid: `sdalg-bogus-${at}`,
      now: NOW,
      ttlDays: 30,
      sdAlgAt: at,
      sdAlgValue: "sha-512",
    });
    const refused = verify({ combined: bogus, issuerPublicKey: fixtureIssuerPublicKey(), now: NOW });
    check(`${at} 的 _sd_alg 認不得就拒絕，不是當成預設值`, codeOf(refused) === "BAD_ALG", codeOf(refused));
  }

  const vp = await wallet.present("childcare_partial");
  check("出示票有 authUri 與交易序號", vp.authUri.length > 0 && vp.txId.length > 0);
  check("第一次輪詢還在等使用者", (await wallet.result(vp.txId)).status === "pending");
  const done = await wallet.result(vp.txId);
  check(
    "childcare_partial 只回兩題以外的欄位被拿掉",
    done.status === "done" && !("movedWithin12m" in done.disclosed) && done.disclosed.childAgeBand === "0-2",
    JSON.stringify(done),
  );

  // A one-shot QR is one-shot: polling past its five minutes fails rather than
  // spinning until the demo ends.
  let clock = NOW;
  const ageing = new FixtureTwdiw(() => clock);
  const stale = await ageing.present("childcare_full");
  clock = new Date(NOW.getTime() + 6 * 60_000);
  const timedOut = await ageing.result(stale.txId);
  check(
    "逾時的出示票回 failed/expired，不會無限輪詢",
    timedOut.status === "failed" && timedOut.reason === "expired",
    JSON.stringify(timedOut),
  );
}

/**
 * The發行端 request shape, pinned without a socket.
 *
 * `fetch` is replaced with a recorder, so what goes on the wire is an assertion
 * rather than something you find out on stage. Every one of these was wrong on
 * the first guess: the header is `Access-Token` (not Bearer, not X-API-KEY),
 * `/qrcode/nodata` cannot carry field values at all, and the deep link is an
 * HTTPS wrapper that must be handed on exactly as it arrived.
 */
async function issuerWireSection() {
  section("發行端的請求形狀（stub fetch，不出網路）");

  const calls: { url: string; init: RequestInit }[] = [];
  const canned: Record<string, unknown> = {
    transactionId: "TX-0038403010-1",
    qrCode: "data:image/png;base64,iVBORw0KGgo=",
    deepLink:
      "https://frontend-uat.wallet.gov.tw/api/moda/vcqrcode?data=bW9kYWRpZ2l0YWx3YWxsZXQ6Ly9jcmVkZW50aWFsX29mZmVyP3E9MQ",
  };
  const cid = "CID-abc123";
  const credential = mintSandboxShapedCredential({
    claims: { residentInNewTaipei: "true" },
    cid,
    now: NOW,
    ttlDays: 30,
  });

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const body = String(url).includes("/credential/nonce/") ? { credential } : canned;
    return new Response(JSON.stringify(body), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const config = twdiwConfig({ TWDIW_ENABLED: "true", TWDIW_API_KEY: "secret-key" });
    check("預設的 vcUid 就是 console 裡登記好的那一張", config.vcUid === DEMO_VC_UID, config.vcUid);
    check("有 api key 就啟用，vcUid 不必自己填", config.enabled, config.disabledReason);

    const sandbox = new SandboxTwdiw(config);
    const ticket = await sandbox.issue({
      residentInNewTaipei: "true",
      movedWithin12m: "true",
      parentChildVerified: "true",
      childAgeBand: "0-2",
      syntheticData: "true",
    });

    const issueCall = calls[0];
    const headers = issueCall.init.headers as Record<string, string>;
    check("認證 header 是 Access-Token", headers[ISSUER_AUTH_HEADER] === "secret-key", JSON.stringify(Object.keys(headers)));
    check(
      "不是 Bearer 也不是 X-API-KEY",
      headers.Authorization === undefined && headers["X-API-KEY"] === undefined,
    );
    check("只打 /api/qrcode/data", issueCall.url.endsWith("/api/qrcode/data"), issueCall.url);

    const sent = JSON.parse(String(issueCall.init.body)) as {
      vcUid: string;
      expiredDate: string;
      issuanceDate: string;
      fields: { ename: string; content: unknown }[];
    };
    check("帶上登記好的 vcUid", sent.vcUid === DEMO_VC_UID, sent.vcUid);
    check("五個欄位都送出去", sent.fields.length === 5, JSON.stringify(sent.fields));
    check(
      "content 一律是字串，沒有任何轉型",
      sent.fields.every((f) => typeof f.content === "string"),
      JSON.stringify(sent.fields),
    );
    check(
      "expiredDate 是 YYYYMMDD，且離發證日 30 天",
      /^\d{8}$/.test(sent.expiredDate) && /^\d{8}$/.test(sent.issuanceDate),
      `${sent.issuanceDate} → ${sent.expiredDate}`,
    );
    check(
      "deepLink 原封回傳，沒有解碼重組",
      ticket.deepLink === canned.deepLink,
      ticket.deepLink,
    );
    check("qrCode 直接當成 data URI 用", ticket.qrCodeDataUri === canned.qrCode);

    const fetched = await sandbox.getCredential("TX-0038403010-1");
    check(
      "取憑證打 /api/credential/nonce/{transactionId}",
      calls[1].url.endsWith("/api/credential/nonce/TX-0038403010-1"),
      calls[1].url,
    );
    check("cid 從回傳憑證的 jti 尾段取出", fetched.cid === cid, fetched.cid);
    const roundTrip = verify({
      combined: fetched.credential,
      issuerPublicKey: fixtureIssuerPublicKey(),
      now: NOW,
    });
    check("取回來的原始憑證就能直接餵進 verify()", roundTrip.ok, codeOf(roundTrip));

    await sandbox.revoke(cid);
    check(
      "撤銷是 PUT /api/credential/{cid}/revocation",
      calls[2].init.method === "PUT" && calls[2].url.endsWith(`/api/credential/${cid}/revocation`),
      `${calls[2].init.method} ${calls[2].url}`,
    );
    check(
      "撤銷的 action enum 只有 revocation",
      JSON.parse(String(calls[2].init.body)).action === "revocation",
    );

    check("發行端到這裡總共只打了三次網路", calls.length === 3, String(calls.length));
  } finally {
    globalThis.fetch = realFetch;
  }
}

/**
 * The 驗證端 request shape, same recorder, still no socket.
 *
 * Two of these are the opposite of the issuer's behaviour and would have been
 * got wrong by analogy: the transaction id is generated here rather than handed
 * back, and HTTP 400 is the waiting state rather than a failure.
 */
async function verifierWireSection() {
  section("驗證端的請求形狀（stub fetch，不出網路）");

  const calls: { url: string; init: RequestInit }[] = [];
  let nextStatus = 200;
  let nextBody: unknown = { qrcodeImage: "data:image/png;base64,QQ==", authUri: "https://wallet.example/vp?x=1" };

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(nextStatus === 400 ? "" : JSON.stringify(nextBody), {
      status: nextStatus,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const config = twdiwConfig({ TWDIW_ENABLED: "true", TWDIW_API_KEY: "secret-key" });
    check(
      "驗證服務代碼用登記好的 ref，含機構前綴",
      config.vpFullRef === DEMO_VP_FULL_REF && config.vpPartialRef === DEMO_VP_PARTIAL_REF,
      `${config.vpFullRef} ／ ${config.vpPartialRef}`,
    );

    const sandbox = new SandboxTwdiw(config);
    const ticket = await sandbox.present("childcare_partial");
    const first = new URL(calls[0].url);
    check(
      "present() 打 GET /api/oidvp/qrcode",
      first.pathname === "/api/oidvp/qrcode" && (calls[0].init.method ?? "GET") === "GET",
      `${calls[0].init.method ?? "GET"} ${first.pathname}`,
    );
    check(
      "帶 ref，值是登記好的驗證服務代碼",
      first.searchParams.get("ref") === DEMO_VP_PARTIAL_REF,
      String(first.searchParams.get("ref")),
    );
    check(
      "驗證端也用 Access-Token 認證",
      (calls[0].init.headers as Record<string, string>)[ISSUER_AUTH_HEADER] === "secret-key",
    );

    const sentTx = first.searchParams.get("transactionId") ?? "";
    check(
      "transactionId 是呼叫端產生的 UUID v4，長度 ≤ 50",
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sentTx) &&
        sentTx.length <= 50,
      sentTx,
    );

    await sandbox.present("childcare_full");
    const secondTx = new URL(calls[1].url).searchParams.get("transactionId");
    check("連續呼叫兩次的 transactionId 不重複", sentTx !== secondTx, `${sentTx} vs ${secondTx}`);
    check(
      "第二次帶的是 full 的 ref",
      new URL(calls[1].url).searchParams.get("ref") === DEMO_VP_FULL_REF,
    );

    check(
      "qrCodeDataUri 取自 qrcodeImage 欄位，不是發行端那個 qrCode",
      ticket.qrCodeDataUri === "data:image/png;base64,QQ==",
      ticket.qrCodeDataUri,
    );
    check(
      "authUri 原封回傳，不解碼重組",
      ticket.authUri === "https://wallet.example/vp?x=1",
      ticket.authUri,
    );
    check("回應沒帶 transactionId 時，沿用自己產生的那一組", ticket.txId === sentTx, ticket.txId);

    nextStatus = 400;
    const waiting = await sandbox.result(sentTx);
    const resultCall = calls[2];
    check(
      "result() 打 POST /api/oidvp/result",
      resultCall.init.method === "POST" && new URL(resultCall.url).pathname === "/api/oidvp/result",
      `${resultCall.init.method} ${resultCall.url}`,
    );
    check(
      "body 就是 {transactionId}",
      serializeBody(JSON.parse(String(resultCall.init.body))) === serializeBody({ transactionId: sentTx }),
      String(resultCall.init.body),
    );
    check(
      "400 是「使用者尚未上傳」→ pending，不是 failed",
      waiting.status === "pending",
      JSON.stringify(waiting),
    );

    nextStatus = 500;
    const broke = await sandbox.result(sentTx);
    check("500 才是 failed", broke.status === "failed", JSON.stringify(broke));

    nextStatus = 200;
    nextBody = { transactionId: sentTx, note: "shape TBD" };
    const done = await sandbox.result(sentTx);
    check(
      "200 回 done，並把還沒公布 schema 的回應原樣帶著",
      done.status === "done" && serializeBody(done.raw) === serializeBody(nextBody),
      JSON.stringify(done),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** With the sandbox off, nothing in this module may reach for the network. */
async function offlineSection() {
  section("停用時完全不打網路");
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    throw new Error("測試期間不該有任何網路呼叫");
  }) as typeof fetch;
  try {
    const offline = twdiwAdapter(twdiwConfig({}));
    const values = claimValues(getState(), NOW);
    const ticket = await offline.issue({ ...values, syntheticData: "true" });
    await offline.getCredential(ticket.transactionId);
    const vp = await offline.present("childcare_full");
    await offline.result(vp.txId);
    await offline.revoke("whatever");
    check("TWDIW_ENABLED=false 時走 fixture，一次網路都沒打", calls.length === 0, calls.join(","));
  } finally {
    globalThis.fetch = realFetch;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

void sandboxSection()
  .then(issuerWireSection)
  .then(verifierWireSection)
  .then(offlineSection)
  .then(() => {
    console.log(
      `\n${pass} passed, ${failures.length} failed${skipped.length ? `, ${skipped.length} skipped` : ""}`,
    );
    if (failures.length) {
      console.log("failed:", failures.join(", "));
      process.exit(1);
    }
  });
