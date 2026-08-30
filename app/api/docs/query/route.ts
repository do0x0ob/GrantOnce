import { NextResponse } from "next/server";

import { answerDocsQuestion } from "@/lib/docs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { question?: string };
  const question = body.question?.trim() ?? "";
  if (!question) {
    return NextResponse.json({ error: "請輸入想查詢的問題" }, { status: 400 });
  }
  if (question.length > 300) {
    return NextResponse.json({ error: "問題請控制在 300 字以內" }, { status: 400 });
  }

  return NextResponse.json(answerDocsQuestion(question));
}
