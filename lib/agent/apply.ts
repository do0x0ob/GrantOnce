import {
  confirmServiceRequest,
  declineServiceRequest,
  openServiceRequests,
} from "@/lib/authz";
import type { DemoState } from "@/lib/types";
import type { TurnResult } from "./turn";

/**
 * The store side of one turn.
 *
 * Lives here rather than inline in the route so the sequencing is testable:
 * which beat opens a requirement, which one mints, and which utterance the plan
 * remembers are all rules, and rules in a route handler are rules nothing
 * guards.
 */
export function applyTurn(state: DemoState, message: string, turn: TurnResult): void {
  // The plan records the situation the person described, which is the discovery
  // utterance — not the narrow 「我要辦這個」 that follows it. Overwriting it with
  // the pick made the watch loop re-derive a situation containing only the
  // benefit just chosen, so it stopped noticing the rest.
  if (turn.programs.length && !turn.opens.length) {
    state.plan = { utterance: message, matchedAt: new Date().toISOString() };
  }

  // A requirement is opened only for a service the person actually picked.
  // Opening one for everything that matched left records behind for services
  // nobody chose.
  if (turn.opens.length) openServiceRequests(state, turn.opens);

  for (const requestId of turn.confirms) confirmServiceRequest(state, requestId);
  for (const requestId of turn.declines) declineServiceRequest(state, requestId);
}
