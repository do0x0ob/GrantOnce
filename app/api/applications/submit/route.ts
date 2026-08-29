import { NextResponse } from "next/server";
import { parseGrantBearer, submitApplication } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    ticket?: string;
  };
  const ticket = (parseGrantBearer(request.headers.get("authorization")) ?? body.ticket ?? "").trim();
  const { state, result } = submitApplication(ticket);
  if (!result.ok) {
    return NextResponse.json({ ...result, state }, { status: 403 });
  }
  return NextResponse.json(state);
}
