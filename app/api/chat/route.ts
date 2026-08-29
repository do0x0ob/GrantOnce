import { NextResponse } from "next/server";
import { proposeGrantsFromPlan } from "@/lib/authz";
import {
  ageHint,
  HAPPY_PATH_UTTERANCE,
  matchPrograms,
  situationFromUtterance,
} from "@/lib/rules";
import { appendChat, mutate } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { message?: string };
  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "請輸入訊息" }, { status: 400 });
  }

  const state = mutate((s) => {
    appendChat(s, "user", message);
    const situation = situationFromUtterance(message);
    if (!situation) {
      appendChat(
        s,
        "agent",
        `這個演示只處理補助比對。請輸入：「${HAPPY_PATH_UTTERANCE}」\n\n資格由規則引擎決定，不會用模型來授權欄位。`,
      );
      return;
    }

    if (!situation.movedRecently) {
      appendChat(
        s,
        "agent",
        "規則引擎沒有偵測到「搬家／遷徙」。快樂路徑請用：「我剛搬家，看我能申請什麼。」",
      );
      return;
    }

    const programs = matchPrograms(situation);
    const hint = ageHint(situation.childAgeMonths);
    s.plan = {
      utterance: message,
      matchedAt: new Date().toISOString(),
      programs,
      ageHint: hint,
      notes: [
        "資格比對只用規則引擎，不用語言模型決定授權。",
        "所得資料在金庫，但不進入任何建議匣。",
        "沒有「一次交出全部資料」的按鈕。",
      ],
    };
    proposeGrantsFromPlan(s, programs);

    const lines = [
      "規則引擎比對結果（非模型授權）：",
      "",
      ...programs.flatMap((p, i) => [
        `${i + 1}. ${p.title} — ${p.agencyName}`,
        `   原因：${p.reasons.join("；")}`,
        `   本匣欄位：${p.requiredFields.join("、")}`,
        p.hint ? `   提示：${p.hint}` : "",
      ]),
      "",
      hint,
      "",
      "兩張授權匣已出現。請分別核准；每一匣只給該機關看得到的欄位。所得不會進入任何匣。",
    ].filter(Boolean);

    appendChat(s, "agent", lines.join("\n"));
  });

  return NextResponse.json(state);
}
