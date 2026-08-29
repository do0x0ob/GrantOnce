import { Button } from "@/components/ui/button";
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

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-lg border bg-[#fbf8f1] p-4",
        grant.status === "proposed" && "border-dashed border-amber-800/40",
        grant.status === "active" && "border-emerald-900/35",
        spent && "border-stone-400 bg-stone-100",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] text-stone-500">授權文書 {grant.id}</p>
          <p className="font-serif text-lg leading-7 text-stone-900">{grant.programTitle}</p>
        </div>
        <span className="stamp shrink-0" data-tone={grant.status}>
          {GRANT_STATUS_LABEL[grant.status]}
        </span>
      </div>

      <dl className="mt-3 space-y-2 text-[13px] leading-5">
        <Row term="目的" detail={grant.purpose} />
        <Row term="簽發人" detail={`${issuer}（本人同意）`} />
        <Row term="收件機關" detail={agencyTitle(grant.agencyId)} />
        <div className="grid grid-cols-[4.5rem_1fr] gap-x-2">
          <dt className="text-stone-500">欄位</dt>
          <dd>
            {groups.map(([group, ids]) => (
              <p key={group} className="text-stone-800">
                <span className="text-stone-500">{group}：</span>
                {ids.map((id) => FIELD_META[id].label).join("、")}
              </p>
            ))}
          </dd>
        </div>
        <Row term="效期" detail={grantExpiry(grant.status)} />
        <Row term="排除" detail="所得、健保。沒有 fields:*" />
      </dl>

      {spent && grant.status !== "revoked" ? (
        <p className="mt-3 text-[13px] font-medium text-stone-700">此匣已耗用，無法再擷取。</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {grant.status === "proposed" || grant.status === "revoked" ? (
            <Button size="sm" disabled={busy} onClick={onApprove}>
              核准這一匣
            </Button>
          ) : null}
          {grant.status === "active" ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={onRevoke}>
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
      <dt className="text-stone-500">{term}</dt>
      <dd className="font-medium text-stone-900">{detail}</dd>
    </div>
  );
}
