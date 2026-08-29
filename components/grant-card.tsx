import { StatusChip } from "@/components/denial-banner";
import { IdentityDot } from "@/components/identity-dot";
import { SURFACE } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { FIELD_META } from "@/lib/fields";
import type { Grant } from "@/lib/types";
import { cn } from "@/lib/utils";
import { agencyTitle, GRANT_STATUS_LABEL, grantExpiry, groupedFields } from "@/lib/view";

const CHIP: Record<Grant["status"], "stone" | "rose" | "mint" | "amber"> = {
  proposed: "amber",
  active: "mint",
  revoked: "stone",
  consumed: "stone",
};

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
  const idColor = grant.agencyId === "jia" ? "text-emerald-700" : "text-amber-700";

  return (
    <article className={cn(SURFACE, "px-5 py-4", spent && "opacity-80")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <IdentityDot tone={tone} />
          <div>
            <p className={cn("text-[15px] leading-6", idColor)}>{grant.id}</p>
            <p className="text-[13px] leading-5 text-stone-500">{grant.programTitle}</p>
          </div>
        </div>
        <StatusChip tone={CHIP[grant.status]}>{GRANT_STATUS_LABEL[grant.status]}</StatusChip>
      </div>

      <div className="mt-3 space-y-1 text-[13px] leading-6 text-stone-600">
        <p>
          <span className="text-stone-400">簽發 </span>
          {issuer}
          <span className="text-stone-400"> · {agencyTitle(grant.agencyId)}</span>
        </p>
        {groups.map(([group, ids]) => (
          <p key={group}>
            <span className="text-stone-400">{group} </span>
            {ids.map((id) => FIELD_META[id].label).join("、")}
          </p>
        ))}
        <p className="text-stone-400">
          {grantExpiry(grant.status)} · 排除所得、健保
        </p>
      </div>

      {grant.status === "proposed" || grant.status === "revoked" ? (
        <div className="mt-3">
          <Button size="sm" className="rounded-full" disabled={busy} onClick={onApprove}>
            核准這一匣
          </Button>
        </div>
      ) : null}
      {grant.status === "active" ? (
        <div className="mt-3">
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-stone-400"
            disabled={busy}
            onClick={onRevoke}
          >
            撤銷
          </Button>
        </div>
      ) : null}
    </article>
  );
}
