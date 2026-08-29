import { scanForChanges } from "./rules";
import { notify } from "./store";
import type { DemoState } from "./types";

/**
 * Runs the look-ahead and pushes anything new, so the agent volunteers changes
 * rather than waiting to be asked. Server-only: it reaches the persisted store,
 * so it must not be imported from a client component.
 */
export function pushChanges(state: DemoState, now: Date): number {
  let pushed = 0;
  for (const change of scanForChanges(state, now)) {
    if (state.notifications.some((n) => n.title === change.title)) continue;
    notify(state, change);
    pushed += 1;
  }
  return pushed;
}
