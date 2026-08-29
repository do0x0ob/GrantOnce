import { NextResponse } from "next/server";
import { restoreDelegation, revokeDelegation, updateDelegation } from "@/lib/authz";
import { principalView } from "@/lib/view";
import type { Sensitivity } from "@/lib/claims";

export const dynamic = "force-dynamic";

/** Only the three levels the wallet actually offers; "special" is never delegable. */
const SENSITIVITIES: Sensitivity[] = ["predicate", "pseudonym", "personal"];

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: "revoke" | "restore" | "update";
    reason?: string;
    maxSensitivity?: string;
  };

  if (body.action === "revoke") {
    return NextResponse.json(principalView(revokeDelegation(body.reason ?? "委託人停止委託")));
  }
  if (body.action === "restore") {
    return NextResponse.json(principalView(restoreDelegation()));
  }
  if (body.action === "update") {
    const patch: Parameters<typeof updateDelegation>[0] = {};
    if (body.maxSensitivity && SENSITIVITIES.includes(body.maxSensitivity as Sensitivity)) {
      patch.maxSensitivity = body.maxSensitivity as Sensitivity;
    }
    return NextResponse.json(principalView(updateDelegation(patch)));
  }
  return NextResponse.json({ error: "未知動作" }, { status: 400 });
}
