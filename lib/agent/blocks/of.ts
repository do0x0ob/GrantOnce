import { normalizeGrantId } from "@/lib/purposes";
import { isPurposeId, PURPOSES } from "@/lib/purposes";
import type { PurposeId } from "@/lib/purposes";
import type { GrantId } from "@/lib/types";
import type {
  Block,
  ClaimsExplainerPayload,
  EligibilityPayload,
  ProgramPickerPayload,
  SuggestionsPayload,
  WorldSearchPayload,
} from "./types";

/**
 * Claim functions: recognise a shape and return a payload, or return null.
 *
 * They must never throw. A turn can be assembled by our own typed code or by a
 * model driving the MCP tools, and the second case will eventually hand us a
 * field of the wrong type. Throwing here would take out the whole thread; a
 * null lets the next matcher try and, failing that, degrades to a fallback.
 */
type Obj = Record<string, unknown>;

const asObj = (o: unknown): Obj | null => {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  // Own enumerable properties only. An object literal's `__proto__` key sets the
  // prototype, so reading straight off the value would let a payload smuggle
  // fields in through the chain and be recognised as a card it is not.
  return Object.fromEntries(Object.entries(o as Obj));
};

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function textOf(o: unknown): string | null {
  const v = asObj(o);
  if (!v) return typeof o === "string" && o.trim() ? o : null;
  const text = str(v.text);
  return text?.trim() ? text : null;
}

export function eligibilityOf(o: unknown): EligibilityPayload | null {
  const v = asObj(o);
  if (!v) return null;
  const reasons = strList(v.reasons);
  if (!reasons.length) return null;
  return {
    reasons,
    withheld: strList(v.withheld),
    ageHint: str(v.ageHint) ?? "",
  };
}

export function signGrantOf(o: unknown): { grantId: GrantId } | null {
  const v = asObj(o);
  if (!v) return null;
  const raw = str(v.grantId);
  if (!raw) return null;
  const grantId = normalizeGrantId(raw);
  return grantId ? { grantId } : null;
}

export function applicationStatusOf(o: unknown): { purpose: PurposeId } | null {
  const v = asObj(o);
  if (!v) return null;
  const purpose = str(v.purpose);
  return purpose && isPurposeId(purpose) ? { purpose } : null;
}

export function programPickerOf(o: unknown): ProgramPickerPayload | null {
  const v = asObj(o);
  if (!v) return null;
  const raw = Array.isArray(v.options) ? v.options : null;
  if (!raw?.length) return null;

  const options = raw
    .map((entry) => {
      const e = asObj(entry);
      const purpose = str(e?.purpose);
      if (!purpose || !isPurposeId(purpose)) return null;
      return {
        purpose,
        title: str(e?.title) ?? PURPOSES[purpose].title,
        detail: str(e?.detail) ?? PURPOSES[purpose].necessity,
      };
    })
    .filter((x): x is ProgramPickerPayload["options"][number] => x !== null);

  if (!options.length) return null;
  return { question: str(v.question) ?? "你想先辦哪一項？", options };
}

export function suggestionsOf(o: unknown): SuggestionsPayload | null {
  const v = asObj(o);
  if (!v) return null;
  const raw = Array.isArray(v.suggestions) ? v.suggestions : null;
  if (!raw?.length) return null;
  const options = raw
    .map((entry) => {
      const e = asObj(entry);
      const utterance = str(e?.utterance);
      if (!utterance) return null;
      return { label: str(e?.label) ?? utterance, utterance };
    })
    .filter((x): x is SuggestionsPayload["options"][number] => x !== null);
  if (!options.length) return null;
  return { question: str(v.question) ?? "你可以問我這些", options };
}

export function claimsExplainerOf(o: unknown): ClaimsExplainerPayload | null {
  const v = asObj(o);
  if (!v) return null;
  const raw = Array.isArray(v.purposes) ? v.purposes : null;
  if (!raw) return null;

  const purposes = raw
    .map((entry) => {
      const e = asObj(entry);
      const purpose = str(e?.purpose);
      if (!purpose || !isPurposeId(purpose)) return null;
      const claims = (Array.isArray(e?.claims) ? e.claims : [])
        .map((c) => {
          const co = asObj(c);
          const label = str(co?.label);
          return label ? { label, shape: str(co?.shape) ?? "" } : null;
        })
        .filter((x): x is { label: string; shape: string } => x !== null);
      return { purpose, title: str(e?.title) ?? PURPOSES[purpose].title, claims };
    })
    .filter((x): x is ClaimsExplainerPayload["purposes"][number] => x !== null);

  const withheld = (Array.isArray(v.withheld) ? v.withheld : [])
    .map((w) => {
      const wo = asObj(w);
      const label = str(wo?.label);
      return label ? { label, basis: str(wo?.basis) ?? "" } : null;
    })
    .filter((x): x is { label: string; basis: string } => x !== null);

  if (!purposes.length && !withheld.length) return null;
  return { purposes, withheld };
}

export function worldSearchOf(o: unknown): WorldSearchPayload | null {
  const v = asObj(o);
  const research = asObj(v?.research);
  if (!research) return null;
  const raw = Array.isArray(research.findings) ? research.findings : [];
  const findings = raw
    .map((entry) => {
      const e = asObj(entry);
      const title = str(e?.title);
      if (!title) return null;
      return {
        title,
        url: str(e?.url) ?? "",
        snippet: str(e?.snippet) ?? "",
        publisher: str(e?.publisher) ?? "",
      };
    })
    .filter((x): x is WorldSearchPayload["findings"][number] => x !== null);
  if (!findings.length) return null;
  return { query: str(research.query) ?? "", note: str(research.note) ?? "", findings };
}

export function auditTrailOf(o: unknown): true | null {
  const v = asObj(o);
  return v?.auditTrail === true ? true : null;
}

export function toolErrorOf(o: unknown): { tool: string; message: string } | null {
  const v = asObj(o);
  if (!v) return null;
  const message = str(v.error) ?? str(v.message);
  if (!message) return null;
  return { tool: str(v.tool) ?? "unknown", message };
}

/** The one place tool output becomes blocks. Order is reading order. */
export function toBlocks(outputs: unknown[]): Block[] {
  const out: Block[] = [];
  for (const o of outputs) {
    const err = toolErrorOf(o);
    if (err) {
      out.push({ kind: "toolError", payload: err });
      continue;
    }
    const eligibility = eligibilityOf(o);
    if (eligibility) {
      out.push({ kind: "eligibility", payload: eligibility });
      continue;
    }
    const world = worldSearchOf(o);
    if (world) {
      out.push({ kind: "worldSearch", payload: world });
      continue;
    }
    const explainer = claimsExplainerOf(o);
    if (explainer) {
      out.push({ kind: "claimsExplainer", payload: explainer });
      continue;
    }
    if (auditTrailOf(o)) {
      out.push({ kind: "auditTrail" });
      continue;
    }
    const suggestions = suggestionsOf(o);
    if (suggestions) {
      out.push({ kind: "suggestions", payload: suggestions });
      continue;
    }
    const picker = programPickerOf(o);
    if (picker) {
      out.push({ kind: "programPicker", payload: picker });
      continue;
    }
    const sign = signGrantOf(o);
    if (sign) {
      out.push({ kind: "signGrant", grantId: sign.grantId });
      continue;
    }
    const status = applicationStatusOf(o);
    if (status) {
      out.push({ kind: "applicationStatus", purpose: status.purpose });
      continue;
    }
    const text = textOf(o);
    if (text) {
      out.push({ kind: "text", text });
      continue;
    }
    // Unrecognised output is dropped rather than forced into a card.
  }
  return out;
}
