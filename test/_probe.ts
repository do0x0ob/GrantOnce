import { toBlocks } from "../lib/agent/blocks/of";
import { runTurn } from "../lib/agent/turn";
import { confirmServiceRequest, declineServiceRequest, openServiceRequests } from "../lib/authz";
import { effectiveToday } from "../lib/rules";
import { getState, mutate, resetState } from "../lib/store";

function say(msg: string) {
  let kinds: string[] = [], text = "";
  mutate((s) => {
    const t = runTurn(s, msg, { today: effectiveToday(s) });
    if (t.opens.length) openServiceRequests(s, t.opens);
    for (const id of t.confirms) confirmServiceRequest(s, id);
    for (const id of t.declines) declineServiceRequest(s, id);
    const b = toBlocks(t.outputs);
    kinds = b.map((x) => x.kind);
    text = b.filter((x) => x.kind === "text").map((x) => (x as { text: string }).text)[0] ?? "";
  });
  const st = getState();
  console.log(`> ${msg}\n   ${kinds.join(" → ")}\n   「${text.slice(0,58)}」`);
  console.log(`   需求 ${st.serviceRequests.map(r=>r.status).join(",") || "無"}　匣 ${st.grants.length}\n`);
}

resetState();
say("我剛搬家，看我能申請什麼。");
say("向新北市政府社會局提出育兒津貼的辦理申請");
say("先不要辦育兒津貼");
