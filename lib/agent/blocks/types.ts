import type { ClaimId } from "@/lib/claims";
import type { PurposeId } from "@/lib/purposes";
import type { GrantId } from "@/lib/types";

/**
 * What one agent turn produced, in the order the user should read it.
 *
 * Blocks name live objects rather than embedding them: a `signGrant` block
 * carries a grant id, not a snapshot of the grant. The card reads the current
 * status from the view, so a reloaded thread cannot offer to sign something
 * that was already signed — the server, not the browser, remembers.
 */
export type Block =
  | { kind: "text"; text: string }
  | { kind: "eligibility"; payload: EligibilityPayload }
  | { kind: "signGrant"; grantId: GrantId }
  | { kind: "applicationStatus"; purpose: PurposeId }
  | { kind: "programPicker"; payload: ProgramPickerPayload }
  | { kind: "suggestions"; payload: SuggestionsPayload }
  | { kind: "claimsExplainer"; payload: ClaimsExplainerPayload }
  | { kind: "auditTrail" }
  | { kind: "toolError"; payload: { tool: string; message: string } };

export type BlockKind = Block["kind"];

export type EligibilityPayload = {
  /** Why the rule engine matched, one line each. */
  reasons: string[];
  /** What it decided not to ask for, so the omission is visible. */
  withheld: string[];
  ageHint: string;
};

export type ProgramPickerPayload = {
  question: string;
  options: { purpose: PurposeId; title: string; detail: string }[];
};

/** Claims a card may show as "this is what the agency receives". */
export type ClaimSummary = { claimId: ClaimId; label: string; shape: string };

/** What the agent can be asked, offered as buttons rather than guessed at. */
export type SuggestionsPayload = {
  question: string;
  options: { label: string; utterance: string }[];
};

/** What each purpose would receive, and what is withheld on what grounds. */
export type ClaimsExplainerPayload = {
  purposes: {
    purpose: PurposeId;
    title: string;
    claims: { label: string; shape: string }[];
  }[];
  withheld: { label: string; basis: string }[];
};
