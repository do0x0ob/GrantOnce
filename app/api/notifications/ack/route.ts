import { NextResponse } from "next/server";
import { appendAudit, mutate, nowIso } from "@/lib/store";
import { AGENT_NAME } from "@/lib/rules";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

/** Signing off a push notice. It records that the principal saw it — nothing more. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = (body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "缺少推播 id" }, { status: 400 });

  let found = false;
  const state = mutate((s) => {
    const n = s.notifications.find((x) => x.id === id);
    if (!n) return;
    found = true;
    if (n.acknowledged) return;
    n.acknowledged = true;
    n.acknowledgedAt = nowIso();
    appendAudit(s, {
      actor: AGENT_NAME,
      actorRole: "agent",
      action: "acknowledge",
      grantId: n.grantId,
      detail: `簽收推播：${n.title}`,
    });
  });

  const view = principalView(state);
  if (!found) return NextResponse.json({ error: `找不到推播 ${id}`, ...view }, { status: 404 });
  return NextResponse.json(view);
}
