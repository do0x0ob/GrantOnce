"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { PageIntro } from "@/components/page-intro";
import { StatusChip } from "@/components/status-chip";
import { SURFACE, WASH } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Demo } from "@/hooks/use-demo";

const MONO = "font-mono text-[11px] leading-5 break-all text-stone-500";
const CARD = cn(SURFACE, "space-y-4 p-7");

type Shown = {
  label: string;
  disclose: string[];
  combined: string;
  length: number;
  verdict: string;
  claims: string[];
};

/** Two presentations from one credential, so 「少給」 is a length you can read. */
const RUNS: { label: string; disclose: string[] }[] = [
  {
    label: "出示四題",
    disclose: ["residentInNewTaipei", "movedWithin12m", "parentChildVerified", "childAgeBand"],
  },
  { label: "出示兩題", disclose: ["residentInNewTaipei", "childAgeBand"] },
];

function Json({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-[20px] bg-white/70 p-4 font-mono text-[11px] leading-5 text-stone-600">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[12px] leading-5 tracking-[0.04em] text-stone-400">{label}</p>
      {children}
    </div>
  );
}

export function CredentialPane({ demo }: { demo: Demo }) {
  const sdJwt = demo.view.sdJwt;
  const twdiw = demo.view.twdiw;
  const [runs, setRuns] = useState<Shown[] | null>(null);
  const [polling, setPolling] = useState(false);
  // Starts null on both sides of hydration and is only ever written from the
  // interval callback, so the server and the first client render agree.
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const expiresAt = twdiw.ticket?.issuance.expiresAt ?? null;
  const remaining =
    clock === null || !expiresAt
      ? null
      : Math.max(0, Math.round((new Date(expiresAt).getTime() - clock) / 1000));

  async function compare() {
    const out: Shown[] = [];
    for (const run of RUNS) {
      const presented = await demo.presentSdJwt(run.disclose);
      const combined = typeof presented.combined === "string" ? presented.combined : "";
      if (!combined) continue;
      const verified = (await demo.verifySdJwt(combined)) as {
        ok?: boolean;
        code?: string;
        claims?: Record<string, unknown>;
      };
      out.push({
        label: run.label,
        disclose: run.disclose,
        combined,
        length: combined.length,
        verdict: verified.ok ? "驗得過" : `拒絕：${verified.code ?? "未知"}`,
        claims: Object.entries(verified.claims ?? {})
          .filter(([key]) => run.disclose.includes(key))
          .map(([key, value]) => `${key} = ${String(value)}`),
      });
    }
    setRuns(out);
  }

  async function poll(txId: string) {
    setPolling(true);
    try {
      // The QR is one-shot and about five minutes long. Polling stops on the
      // first terminal answer rather than running until the demo ends.
      for (let i = 0; i < 30; i++) {
        const data = (await demo.twdiwResult(txId)) as { result?: { status?: string } };
        if (data.result?.status !== "pending") return;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } finally {
      setPolling(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[44rem] space-y-10 px-6 py-10 sm:px-8">
      <PageIntro kicker="憑證層" title="述詞憑證">
        同一份述詞，兩條供應線。上面是 GrantOnce 自己簽的 SD-JWT，攤開來看得到
        <code className="px-1 font-mono text-[14px]">_sd</code> 裡只有摘要；下面是送進數位憑證皮夾沙盒的那一張。
        兩條都不經過授權匣，兌現路徑一個字都沒有動。
      </PageIntro>

      <section className={cn(CARD, WASH.sage)}>
        <header className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[17px] leading-6 text-stone-800">GrantOnce 自建發證</p>
            <p className="text-[13px] leading-5 text-stone-500">
              戶政以 ed25519 簽一張 SD-JWT，四筆 disclosure 加兩筆 decoy。
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            disabled={demo.busy || !demo.view.principal.key.registered}
            onClick={() => void demo.issueSdJwt()}
          >
            {sdJwt ? "重新簽一張" : "簽一張"}
          </Button>
        </header>

        {!demo.view.principal.key.registered ? (
          <p className="text-[14px] leading-6 text-[var(--clay)]">
            還沒有委託人金鑰。憑證的
            <code className="px-1 font-mono text-[13px]">cnf.jwk</code>
            要綁持有人的公鑰，所以請先到「授權」註冊一把。
          </p>
        ) : null}

        {sdJwt ? (
          <div className="space-y-5">
            <Row label="JWT HEADER">
              <Json value={sdJwt.header} />
            </Row>
            <Row label="JWT PAYLOAD（述詞的名稱與值都不在裡面）">
              <Json value={sdJwt.payload} />
            </Row>
            <Row label={`_sd（${sdJwt.sdDigests.length} 筆摘要）`}>
              <ul className="space-y-1">
                {sdJwt.sdDigests.map((entry) => (
                  <li key={entry.digest} className="flex items-baseline gap-2">
                    <span className={MONO}>{entry.digest}</span>
                    {entry.decoy ? (
                      <StatusChip tone="stone">無對應 disclosure</StatusChip>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Row>
            <Row label="DISCLOSURE 原始字串與解碼後的 [salt, name, value]">
              <ul className="space-y-3">
                {sdJwt.disclosures.map((d) => (
                  <li key={d.encoded} className="space-y-1 rounded-[20px] bg-white/70 p-4">
                    <p className={MONO}>{d.encoded}</p>
                    <p className="font-mono text-[12px] leading-5 text-stone-700">
                      [{JSON.stringify(d.salt)}, {JSON.stringify(d.name)}, {JSON.stringify(d.value)}]
                    </p>
                    <p className="font-mono text-[11px] leading-5 text-stone-400">→ {d.digest}</p>
                  </li>
                ))}
              </ul>
            </Row>

            <div className="space-y-3">
              <Button
                variant="secondary"
                size="sm"
                className="rounded-full"
                disabled={demo.busy}
                onClick={() => void compare()}
              >
                出示四題 vs 出示兩題
              </Button>
              {runs ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {runs.map((run) => (
                    <article key={run.label} className="space-y-2 rounded-[20px] bg-white/70 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[15px] leading-6 text-stone-800">{run.label}</p>
                        <StatusChip tone={run.verdict === "驗得過" ? "mint" : "stone"}>
                          {run.verdict}
                        </StatusChip>
                      </div>
                      <p className="text-[13px] leading-5 text-stone-500">
                        組合字串 {run.length} 字元
                      </p>
                      <ul className="space-y-0.5">
                        {run.claims.map((line) => (
                          <li key={line} className="font-mono text-[12px] leading-5 text-stone-700">
                            {line}
                          </li>
                        ))}
                      </ul>
                      <p className={MONO}>{run.combined}</p>
                    </article>
                  ))}
                </div>
              ) : null}
              <p className="text-[13px] leading-5 text-stone-400">
                這一段不產生 KB-JWT：委託人的私鑰由 passkey PRF 在瀏覽器裡派生，伺服器拿不到。
                驗證端的 key binding 檢查已經實作，`test/sdjwt.ts` 有七條。
              </p>
            </div>
          </div>
        ) : null}
      </section>

      <section className={cn(CARD, twdiw.enabled ? WASH.clay : WASH.orchid)}>
        <header className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-[17px] leading-6 text-stone-800">數位憑證皮夾沙盒</p>
            <p className="text-[13px] leading-5 text-stone-500">
              同樣四個述詞，寫進 {twdiw.issuerBase}，效期取最小的 {twdiw.ttlDays} 天。
            </p>
          </div>
          <StatusChip tone={twdiw.enabled ? "mint" : "stone"}>
            {twdiw.enabled ? "已啟用" : "停用中"}
          </StatusChip>
        </header>

        {!twdiw.enabled ? (
          <p className="text-[14px] leading-6 text-stone-600">
            這一區沒有隱藏，只是關著：{twdiw.disabledReason}。補齊環境變數就會打真的沙盒；
            在那之前不會發出任何網路請求。
          </p>
        ) : null}

        <Row label="即將寫入的欄位">
          <ul className="space-y-1">
            {twdiw.fields.map((field) => (
              <li key={field.ename} className="font-mono text-[12px] leading-5 text-stone-700">
                {field.ename} = {JSON.stringify(field.content)}
              </li>
            ))}
          </ul>
        </Row>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            disabled={demo.busy || !twdiw.enabled}
            onClick={() => void demo.twdiwIssue()}
          >
            {twdiw.ticket ? "重新產生" : "發一張述詞憑證"}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            disabled={demo.busy || !twdiw.enabled}
            onClick={() => void demo.twdiwPresent(twdiw.vpFullId)}
          >
            用 OID4VP 出示 · 四題
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full"
            disabled={demo.busy || !twdiw.enabled}
            onClick={() => void demo.twdiwPresent(twdiw.vpPartialId)}
          >
            出示 · 兩題
          </Button>
        </div>

        {twdiw.ticket ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              {/* The sandbox already returns the QR as a PNG data URI. */}
              <Image
                src={twdiw.ticket.issuance.qrCodeDataUri}
                alt="皮夾發證 QR"
                width={144}
                height={144}
                unoptimized
                className="size-36 rounded-[20px] bg-white p-2 [image-rendering:pixelated]"
              />
              <div className="space-y-2">
                <p className="text-[13px] leading-5 text-stone-500">
                  {remaining === null
                    ? "計時中"
                    : remaining > 0
                      ? `${remaining} 秒後失效`
                      : "已失效，請重新產生"}
                </p>
                <a
                  className="inline-flex rounded-full bg-[var(--ink)] px-4 py-1.5 text-[13px] leading-5 text-[var(--primary-foreground)]"
                  href={twdiw.ticket.issuance.deepLink}
                >
                  用皮夾開啟
                </a>
                <p className={MONO}>{twdiw.ticket.issuance.transactionId}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                disabled={demo.busy}
                onClick={() =>
                  void demo.twdiwCredential(twdiw.ticket!.issuance.transactionId)
                }
              >
                取回原始憑證
              </Button>
              {twdiw.ticket.cid && !twdiw.ticket.revokedAt ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full text-[var(--orchid-deep)]"
                  disabled={demo.busy}
                  onClick={() => void demo.twdiwRevoke(twdiw.ticket!.cid!)}
                >
                  撤銷（不可逆）
                </Button>
              ) : null}
              {twdiw.ticket.presentation ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="rounded-full"
                  disabled={demo.busy || polling}
                  onClick={() => void poll(twdiw.ticket!.presentation!.ticket.txId)}
                >
                  {polling ? "等皮夾回覆…" : "輪詢出示結果"}
                </Button>
              ) : null}
            </div>

            {twdiw.ticket.revokedAt ? (
              <p className="text-[13px] leading-5 text-[var(--orchid-deep)]">
                已於 {twdiw.ticket.revokedAt} 撤銷。沙盒的 action 只有 revocation，沒有復原。
              </p>
            ) : null}
            {twdiw.ticket.credential ? (
              <Row label={`原始憑證${twdiw.ticket.cid ? `（cid ${twdiw.ticket.cid}）` : ""}`}>
                <p className={MONO}>{twdiw.ticket.credential}</p>
              </Row>
            ) : null}
            {twdiw.ticket.lastResult ? (
              <Row label={`出示結果 · ${twdiw.ticket.presentation?.vp ?? ""}`}>
                <Json value={twdiw.ticket.lastResult} />
              </Row>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
