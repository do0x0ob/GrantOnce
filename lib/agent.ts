import { scanForChanges } from "./rules";
import { mutate, notify, nowIso, reconcileApplications } from "./store";
import type { DemoState, Notification } from "./types";

/** How often the watch loop runs when the MCP server is hosting it. */
export const TICK_MS = Number(process.env.GRANTONCE_TICK_MS ?? 15000);

/**
 * One watch pass over an already-locked state.
 *
 * Idempotent by construction: a notice is pushed only when nothing with the
 * same `key` is on file, so running the pass twice pushes nothing the second
 * time. Keying on the title instead — which is what this used to do — meant a
 * reworded title pushed the same condition all over again.
 */
function applyTick(state: DemoState, now: Date): Notification[] {
  // Drop notices that have stopped being true, so 「再 3 個月滿 2 歲」 does not
  // sit there after the child has turned two. Acknowledged ones stay: they are
  // the record that the principal saw it.
  state.notifications = state.notifications.filter(
    (n) =>
      n.acknowledged || !n.staleAfter || new Date(n.staleAfter).getTime() > now.getTime(),
  );

  const pushed: Notification[] = [];
  for (const change of scanForChanges(state, now)) {
    if (state.notifications.some((n) => n.key === change.key)) continue;
    pushed.push(notify(state, change));
  }

  reconcileApplications(state);
  // Proof that the loop ran, whether or not it had anything to say. Writing an
  // audit entry every pass would bury the trail the demo is built on.
  state.lastTickAt = nowIso();
  return pushed;
}

/**
 * One watch pass, taking the store lock itself.
 *
 * This is what the MCP server's ticker calls, so the agent looks without being
 * asked. Returns the notices this pass actually pushed, for the caller to
 * announce over the protocol.
 */
export function runAgentTick(now = new Date()): Notification[] {
  let pushed: Notification[] = [];
  mutate((s) => {
    pushed = applyTick(s, now);
  });
  return pushed;
}

/**
 * The same pass for callers that already hold the lock and a state object.
 * Server-only: it reaches the persisted store, so it must not be imported from
 * a client component.
 */
export function pushChanges(state: DemoState, now: Date): number {
  return applyTick(state, now).length;
}
