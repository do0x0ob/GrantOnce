import { NextResponse } from "next/server";
import { fetchWithGrant, parseGrantBearer } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const grantId = parseGrantBearer(request.headers.get("authorization"));
  if (!grantId) {
    return NextResponse.json(
      { error: "請使用 Authorization: Bearer Grant <id>", state: null },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    fields?: string[];
    actor?: "agent" | "agency-jia" | "agency-yi";
    actorName?: string;
  };
  const fields = Array.isArray(body.fields) ? body.fields : [];
  const role = body.actor ?? "agent";
  const name =
    body.actorName ??
    (role === "agency-jia"
      ? "甲｜新北市社會局"
      : role === "agency-yi"
        ? "乙｜經濟部能源署 × 台電"
        : "補助代理人");

  const { state, result } = fetchWithGrant(grantId, fields, { name, role });
  if (!result.ok) {
    return NextResponse.json({ ...result, state }, { status: 403 });
  }
  return NextResponse.json({ ...result, state });
}
