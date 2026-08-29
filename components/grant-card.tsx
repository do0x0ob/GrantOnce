import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FIELD_META } from "@/lib/fields";
import type { Grant } from "@/lib/types";
import { GRANT_STATUS_LABEL, groupedFields } from "@/lib/view";

const STATUS_CLASS: Record<Grant["status"], string> = {
  proposed: "border-dashed border-amber-800/50 bg-amber-50/80",
  active: "border-emerald-900/30 bg-emerald-50/70",
  revoked: "border-stone-400 bg-stone-100/80 opacity-80",
  consumed: "border-stone-500 bg-stone-200/70",
};

export function GrantCard({
  grant,
  busy,
  onApprove,
  onRevoke,
}: {
  grant: Grant;
  busy: boolean;
  onApprove: () => void;
  onRevoke: () => void;
}) {
  const groups = groupedFields(grant.fields);
  return (
    <Card className={`shadow-none ${STATUS_CLASS[grant.status]}`}>
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-[11px] tracking-wide text-stone-500">
              授權匣 {grant.id}
            </p>
            <CardTitle className="font-serif text-lg">{grant.programTitle}</CardTitle>
            <p className="text-xs text-stone-600">
              {grant.agencyId === "jia" ? "機關甲 · 新北市社會局" : "機關乙 · 經濟部 × 台電"}
            </p>
          </div>
          <span
            className="stamp"
            data-tone={grant.status}
          >
            {GRANT_STATUS_LABEL[grant.status]}
          </span>
        </div>
        <p className="text-xs text-stone-600">{grant.purpose}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.map(([group, ids]) => (
          <div key={group}>
            <p className="mb-1 text-[11px] font-medium tracking-wide text-stone-500">
              {group}
            </p>
            <div className="flex flex-wrap gap-1">
              {ids.map((id) => (
                <Badge key={id} variant="outline" className="rounded-md font-normal">
                  {FIELD_META[id].label}
                </Badge>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[11px] text-stone-500">不含所得、不含健保、沒有 fields:*</p>
        <div className="flex flex-wrap gap-2">
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
      </CardContent>
    </Card>
  );
}
