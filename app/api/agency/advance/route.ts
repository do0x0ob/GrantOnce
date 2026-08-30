import { NextResponse } from "next/server";
import { isPurposeId } from "@/lib/purposes";
import { appendAudit, mutate, nowIso } from "@/lib/store";
import { isApplicationStatus } from "@/lib/types";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

/**
 * Demo-only. Nothing past 「已送件」 is driven by a real agency, so the stage
 * advances it by hand rather than pretending a connection exists. Progress
 * tracking has a place in the protocol; this is not that place being filled in.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    purpose?: string;
    status?: string;
  };
  if (!body.purpose || !isPurposeId(body.purpose)) {
    return NextResponse.json({ error: "未登記的目的" }, { status: 400 });
  }
  if (!body.status || !isApplicationStatus(body.status)) {
    return NextResponse.json({ error: "未知的申辦狀態" }, { status: 400 });
  }
  const purpose = body.purpose;
  const status = body.status;

  const state = mutate((s) => {
    const inbox = s.inboxes[purpose];
    inbox.applicationStatus = status;
    inbox.statusChangedAt = nowIso();
    const grant = s.grants.find((item) => item.body.purpose === purpose);
    const serviceRequest = grant
      ? s.serviceRequests.find((item) => item.id === grant.body.requestId)
      : null;
    if (serviceRequest && (status === "approved" || status === "paid")) {
      serviceRequest.status = "completed";
      serviceRequest.completedAt = inbox.statusChangedAt;
      serviceRequest.resultSummary =
        status === "paid" ? `${inbox.programTitle} 已完成撥款。` : `${inbox.programTitle} 已核定。`;
      appendAudit(s, {
        actor: inbox.name,
        actorRole: inbox.agencyId === "jia" ? "agency-jia" : "agency-yi",
        action: "complete",
        grantId: grant?.id,
        detail: `${serviceRequest.resultSummary}此狀態為演示資料，未連真實機關。`,
      });
    }
  });
  return NextResponse.json(principalView(state));
}
