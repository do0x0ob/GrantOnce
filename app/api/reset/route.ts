import { NextResponse } from "next/server";
import { resetState } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

export function POST() {
  return NextResponse.json(principalView(resetState()));
}
