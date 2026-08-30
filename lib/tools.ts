/**
 * The tool surface the model is allowed to reach.
 *
 * It lives in `lib/` rather than in `mcp/` because the data model refers to it:
 * a notification's `suggestedAction` may only name a tool that exists, and the
 * invariant that makes that safe is right here — **there is no signing tool, and
 * there never will be**. A suggestion can therefore never be a step that mints
 * authority, whatever the model does with it.
 */
export const TOOL_NAMES = [
  "search_purposes",
  "plan_applications",
  "request_service",
  "get_grant_for_signature",
  "redeem_grant",
  "request_claims",
  "submit_application",
  "revoke_grant",
  "stop_delegation",
  "get_audit",
  "get_notifications",
  "acknowledge_notification",
  "get_pending_actions",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(value);
}
