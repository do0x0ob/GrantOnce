import { NextResponse } from "next/server";
import { retirePurpose, upsertPurpose } from "@/lib/registry-io";
import { getState } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(principalView(getState()));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    purpose?: {
      id?: string;
      title?: string;
      agency?: string;
      privacyBasis?: string[];
      allowedClaims?: string[];
      maxTtlSeconds?: number;
      necessity?: string;
    };
    id?: string;
  };

  if (body.action === "registry.upsert") {
    const purpose = body.purpose ?? {};
    const { state, error } = upsertPurpose({
      id: purpose.id ?? "",
      title: purpose.title ?? "",
      agency: purpose.agency ?? "",
      privacyBasis: purpose.privacyBasis ?? [],
      allowedClaims: purpose.allowedClaims ?? [],
      maxTtlSeconds: purpose.maxTtlSeconds ?? 0,
      necessity: purpose.necessity ?? "",
    });
    if (error) return NextResponse.json({ error, ...principalView(state) }, { status: 400 });
    return NextResponse.json(principalView(state));
  }

  if (body.action === "registry.retire") {
    const { state, error } = retirePurpose(body.id ?? "");
    if (error) return NextResponse.json({ error, ...principalView(state) }, { status: 400 });
    return NextResponse.json(principalView(state));
  }

  return NextResponse.json({ error: "未知的登記台動作" }, { status: 400 });
}
