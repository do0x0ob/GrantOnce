import { NextResponse } from "next/server";
import { pushChanges } from "@/lib/agent";
import { mutate } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

/** The proactive half: look ahead for entitlement changes and push them. */
export async function POST() {
  const now = new Date();
  return NextResponse.json(principalView(mutate((s) => pushChanges(s, now))));
}
