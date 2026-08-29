import { Button } from "@/components/ui/button";
import { IdentityDot } from "@/components/identity-dot";
import { FIELD_META } from "@/lib/fields";
import type { Grant } from "@/lib/types";
import { agencyTitle, GRANT_STATUS_LABEL, grantExpiry, groupedFields } from "@/lib/view";
import { cn } from "@/lib/utils";

export function GrantCard({
  grant,
  issuer,
  busy,
  onApprove,
  onRevoke,
}: {
  grant: Grant;
  issuer: string;
  busy: boolean;
  onApprove: () => void;
  onRevoke: () => void;
}) {
  const groups = groupedFields(grant.fields);
  const spent = grant.status === "consumed" || grant.status === "revoked";
  const tone = grant.agencyId === "jia" ? "jia" : "yi";

  return (
    <article
      className={cn(
        "rounded-[20px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        spent && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <IdentityDot tone={tone} />
          <div>
            <p className="text-[12px] text-neutral-500">{grant.id}</p>
            <p className="text-[15px] font-medium tracking-tight text-neutral-900">
              {grant.programTitle}
            </p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
            grant.status === "active" && "bg-emerald-50 text-emerald-700",
            grant.status === "proposed" && "bg-neutral-100 text-neutral-600",
            grant.status === "consumed" && "bg-neutral-200 text-neutral-700",
            grant.status === "revoked" && "bg-neutral-200 text-neutral-600",
          )}
        >
          {GRANT_STATUS_LABEL[grant.status]}
        </span>
      </div>

      <dl className="mt-3 space-y-1.5 text-[13px] leading-5">
        <Row term="目的" detail={grant.purpose} />
        <Row term="簽發人" detail={`${issuer}（本人同意）`} />
        <Row term="收件機關" detail={agencyTitle(grant.agencyId)} />
        <div className="grid grid-cols-[4.5rem_1fr] gap-x-2">
          <dt className="text-neutral-500">欄位</dt>
          <dd className="text-neutral-800">
            {groups.map(([group, ids]) => (
              <p key={group}>
                {group}：{ids.map((id) => FIELD_META[id].label).join("、")}
              </p>
            ))}
          </dd>
        </div>
        <Row term="效期" detail={grantExpiry(grant.status)} />
        <Row term="排除" detail="所得、健保。沒有 fields:*" />
      </dl>

      {spent && grant.status !== "revoked" ? (
        <p className="mt-3 text-[13px] text-neutral-600">此匣已耗用，無法再擷取。</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {grant.status === "proposed" || grant.status === "revoked" ? (
            <Button size="sm" className="rounded-full" disabled={busy} onClick={onApprove}>
              核准這一匣
            </Button>
          ) : null}
          {grant.status === "active" ? (
            <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={onRevoke}>
              撤銷
            </Button>
          ) : null}
        </div>
      )}
    </article>
  );
}

function Row({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-x-2">
      <dt className="text-neutral-500">{term}</dt>
      <dd className="text-neutral-800">{detail}</dd>
    </div>
  );
}
