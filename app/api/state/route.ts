import { NextResponse } from "next/server";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getState());
}
