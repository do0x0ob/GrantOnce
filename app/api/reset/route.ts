import { NextResponse } from "next/server";
import { resetState } from "@/lib/store";

export const dynamic = "force-dynamic";

export function POST() {
  return NextResponse.json(resetState());
}
