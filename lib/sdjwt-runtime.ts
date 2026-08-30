/**
 * The bits the eight routes share: one wallet adapter for the process, and the
 * two guards every response goes through.
 *
 * The adapter is a module singleton because `FixtureTwdiw` holds its
 * transactions in memory. A restart loses them, and the routes say so rather
 * than inventing a credential for a transaction nobody issued.
 */
import { assertNoVaultLeak } from "@/mcp/tools";
import { effectiveNow } from "@/lib/rules";
import {
  claimValues,
  SYNTHETIC_FIELD,
  twdiwAdapter,
  twdiwConfig,
  type TwdiwAdapter,
} from "@/lib/twdiw";
import type { DemoState } from "@/lib/types";

let adapter: TwdiwAdapter | null = null;

export function wallet(): TwdiwAdapter {
  adapter ??= twdiwAdapter();
  return adapter;
}

export function sandboxOff(): { ok: false; reason: string } | null {
  const config = twdiwConfig();
  // Off is a state, not an error: the panel stays on screen and explains itself.
  return config.enabled ? null : { ok: false, reason: "disabled" };
}

/** The four 戶政 predicates, straight from `CLAIM_DEFS`. Our own SD-JWT carries
 *  exactly these — `syntheticData` is a field the sandbox template asks for, not
 *  a predicate about the principal. */
export function predicatesFor(state: DemoState): Record<string, string> {
  return claimValues(state, effectiveNow(state));
}

/** The five values the sandbox writes: the four predicates plus the marker. */
export function fieldsFor(state: DemoState): Record<string, string> {
  return { ...predicatesFor(state), [SYNTHETIC_FIELD.ename]: SYNTHETIC_FIELD.content };
}

export { assertNoVaultLeak };
