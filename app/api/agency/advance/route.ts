import { NextResponse } from "next/server";
import { isKnownAgency } from "@/lib/parties";
import { mutate, nowIso } from "@/lib/store";
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
    agency?: string;
    status?: string;
  };
  if (!body.agency || !isKnownAgency(body.agency)) {
    return NextResponse.json({ error: "未登記的機關" }, { status: 400 });
  }
  if (!body.status || !isApplicationStatus(body.status)) {
    return NextResponse.json({ error: "未知的申辦狀態" }, { status: 400 });
  }
  const agency = body.agency;
  const status = body.status;

  const state = mutate((s) => {
    s.inboxes[agency].applicationStatus = status;
    s.inboxes[agency].statusChangedAt = nowIso();
  });
  return NextResponse.json(principalView(state));
}
