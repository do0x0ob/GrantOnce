import { NextResponse } from "next/server";
import { fetchWithGrant, parseGrantBearer } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = parseGrantBearer(request.headers.get("authorization"));
  if (!token) {
    return NextResponse.json(
      { error: "請使用 Authorization: Bearer Grant <ticket>", state: null },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    fields?: string[];
  };
  const fields = Array.isArray(body.fields) ? body.fields : [];

  const { state, result } = fetchWithGrant(token, fields);
  if (!result.ok) {
    return NextResponse.json({ ...result, state }, { status: 403 });
  }
  return NextResponse.json({ ...result, state });
}
