import { NextResponse } from "next/server";
import { getState } from "@/lib/store";
import { principalView } from "@/lib/view";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(principalView(getState()));
}
