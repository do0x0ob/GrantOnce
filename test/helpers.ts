import { confirmServiceRequest, openServiceRequests } from "../lib/authz";
import type { DemoState, ProgramPlan } from "../lib/types";

/**
 * Open a requirement and confirm it, in one call.
 *
 * Tests legitimately need to reach the later states quickly. Production has no
 * such shortcut on purpose: every real path opens a requirement and then waits
 * for the person, so 「未確認就沒有匣」 holds in the app, over MCP, and on the
 * agency's own request path alike.
 */
export function openAndConfirm(state: DemoState, programs: ProgramPlan[]): void {
  for (const request of openServiceRequests(state, programs)) {
    confirmServiceRequest(state, request.id);
  }
}
