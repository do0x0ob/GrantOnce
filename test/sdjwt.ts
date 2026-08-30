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
import {
  claimValues,
  credentialTtlDays,
  FixtureTwdiw,
  fixtureIssuerPublicKey,
  twdiwConfig,
  TWDIW_FIELDS,
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

function payloadOf(jwt: string): Record<string, unknown> {
  return JSON.parse(decoder.decode(unb64u(jwt.split(".")[1])));
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

  const sandboxFixture = "test/fixtures/sandbox-sdjwt.txt";
  if (existsSync(sandboxFixture)) {
    const combined = readFileSync(sandboxFixture, "utf8").trim();
    const key = process.env.TWDIW_FIXTURE_ISSUER_KEY ?? "";
    if (!key) {
      skip("verify() 驗得過 test/fixtures/sandbox-sdjwt.txt", "缺 TWDIW_FIXTURE_ISSUER_KEY");
    } else {
      const result = verify({ combined, issuerPublicKey: key, now: new Date() });
      check("verify() 驗得過 test/fixtures/sandbox-sdjwt.txt", result.ok, codeOf(result));
    }
  } else {
    skip("verify() 驗得過 test/fixtures/sandbox-sdjwt.txt", "沙盒 fixture 尚未提供");
  }
}

async function sandboxSection() {
  section("沙盒 adapter");
  resetState();
  const state = getState();
  const config = twdiwConfig({});
  check("沒有環境變數時沙盒是停用的", !config.enabled && config.disabledReason.length > 0, config.disabledReason);
  check(
    "TWDIW_ENABLED=true 但缺 vcUid 仍是停用",
    !twdiwConfig({ TWDIW_ENABLED: "true", TWDIW_API_KEY: "k" }).enabled,
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
    "發證票有 QR data URI 與 deep link",
    ticket.qrCodeDataUri.startsWith("data:image/png;base64,") &&
      ticket.deepLink.startsWith("modadigitalwallet://"),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

void sandboxSection().then(() => {
  console.log(`\n${pass} passed, ${failures.length} failed${skipped.length ? `, ${skipped.length} skipped` : ""}`);
  if (failures.length) {
    console.log("failed:", failures.join(", "));
    process.exit(1);
  }
});
