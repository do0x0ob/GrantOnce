"use client";

import { CardHead } from "@/components/agent/card-head";
import { StatusChip } from "@/components/status-chip";
import { SURFACE } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Demo } from "@/hooks/use-demo";
import type { GrantId } from "@/lib/types";

/**
 * The beat between 「已簽署」 and 「已送件」.
 *
 * Like the signing card, this names a capsule and reads its status from the
 * view rather than remembering anything itself, so a reloaded thread cannot
 * offer to deliver something already delivered.
 *
 * The button asks the agency to come and collect; it does not hand the data
 * over. Redemption still turns the second key — the agency signs a proof of
 * holding, bound to this capsule's digest, and the purpose registry is checked
 * again at that moment. Either one failing is a refusal, and the refusal is
 * what the card then shows.
 */
export function DeliverCard({ grantId, demo }: { grantId: GrantId; demo: Demo }) {
  const grant = demo.view.grants.find((g) => g.id === grantId);

  if (!grant) {
    return (
      <section className={cn(SURFACE, "px-6 py-5")}>
        <p className="text-[13px] leading-6 text-stone-500">
          這張匣 {grantId} 已經不在了。條件變了就會重新提案一張新的——舊的不會沿用。
        </p>
      </section>
    );
  }

  const inbox = demo.view.inboxes[grant.purpose];
  const submitted = Boolean(inbox?.submittedAt);
  const delivered = grant.status === "redeemed";
  const ready = grant.status === "signed";
  const denial = inbox?.lastDenial ?? null;

  const status = submitted ? (
    <StatusChip tone="mint">已送件</StatusChip>
  ) : delivered ? (
    <StatusChip tone="mint">已交付</StatusChip>
  ) : ready ? (
    <StatusChip tone="stone">等機關來收</StatusChip>
  ) : (
    <StatusChip tone="stone">等你簽署</StatusChip>
  );

  return (
    <section className={cn(SURFACE, "space-y-4 px-6 py-5")}>
      <CardHead
        title={submitted ? "已送到機關收件匣" : "交付給機關"}
        sub={`${grant.programTitle} · ${grant.agencyName}`}
        status={status}
      />

      {submitted ? (
        <p className="text-[13px] leading-6 text-stone-600">
          {inbox?.claims.length} 項述詞已交付並完成送件。機關收到的就是這幾個是非題與級距，沒有姓名、地址或出生日期。
        </p>
      ) : ready ? (
        <p className="text-[13px] leading-6 text-stone-600">
          匣已經簽好了。按下去等於通知機關來兌現：機關要簽出自己的持有證明、目的登記表要再查一次，兩者都成立才會交付。
        </p>
      ) : (
        <p className="text-[13px] leading-6 text-stone-500">
          先在上面簽署這張匣。沒有你的簽章，這一步不會有東西可以交付。
        </p>
      )}

      {denial && !submitted ? (
        <p className="text-[13px] leading-6 text-[var(--orchid-deep)]">上一次被擋下：{denial}</p>
      ) : null}

      {!submitted ? (
        <Button
          size="xl"
          className="w-full"
          disabled={demo.busy || !ready}
          onClick={() => void demo.deliver(grantId, grant.agencyId)}
        >
          請機關兌現並送件
        </Button>
      ) : null}

      <p className="text-[12px] leading-5 text-stone-400">
        本演示的機關持有證明是在伺服器內現簽的。授權層本身要求真正的機關簽章，正式版必須把機關私鑰移回機關自己的服務。
      </p>
    </section>
  );
}
