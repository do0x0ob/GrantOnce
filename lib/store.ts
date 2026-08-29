import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FIELD_META, GRANT_FIELDS } from "./fields";
import { audienceOfAgency, expiresAtFrom } from "./grant";
import { HAPPY_PATH_UTTERANCE } from "./rules";
import type {
  AgencyId,
  AuditAction,
  AuditEntry,
  ChatMessage,
  DemoState,
  FieldId,
  Grant,
  GrantId,
  VaultHolding,
} from "./types";
import { FIELD_IDS } from "./types";
import { VAULT } from "./vault";

const STORE_PATH = process.env.GRANTONCE_STORE ?? "/tmp/grantonce-runtime.json";

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function buildVaultHoldings(): VaultHolding[] {
  return FIELD_IDS.map((fieldId) => ({
    fieldId,
    label: FIELD_META[fieldId].label,
    group: FIELD_META[fieldId].group,
    value: VAULT.records[fieldId],
    sealed: Boolean(FIELD_META[fieldId].sealed),
  }));
}

export function createInitialState(): DemoState {
  const at = nowIso();
  return {
    principal: {
      id: "P-lin-demo",
      name: "林曉晴",
      summary: "合成演示身分：剛從臺北市遷到新北市，家中有一歲幼兒。",
      synthetic: true,
    },
    vaultCatalog: FIELD_IDS.map((fieldId) => ({
      fieldId,
      label: FIELD_META[fieldId].label,
      group: FIELD_META[fieldId].group,
      inVault: true,
      sealed: Boolean(FIELD_META[fieldId].sealed),
      note: FIELD_META[fieldId].note,
    })),
    vaultHoldings: buildVaultHoldings(),
    grants: [],
    envelopes: {
      "G-甲": emptyEnvelope("G-甲", "jia"),
      "G-乙": emptyEnvelope("G-乙", "yi"),
    },
    audit: [],
    chat: [
      {
        id: "welcome",
        role: "agent",
        at,
        text: `我是補助申請代理人。資格用規則引擎比對，授權匣決定我能讀哪些欄位。\n\n金庫裡有所得與健保，但沒有你的核准，我看不到、機關也拿不到。\n\n試著輸入：「${HAPPY_PATH_UTTERANCE}」`,
      },
    ],
    plan: null,
    lastProtocol: null,
    agencies: {
      jia: {
        id: "jia",
        name: "甲｜新北市社會局",
        programTitle: "育兒津貼",
        lastDenial: null,
        lastDeniedAt: null,
        submittedAt: null,
      },
      yi: {
        id: "yi",
        name: "乙｜經濟部能源署 × 台電",
        programTitle: "冷氣汰換補助",
        lastDenial: null,
        lastDeniedAt: null,
        submittedAt: null,
      },
    },
  };
}

let memory: DemoState | null = null;

function persist(state: DemoState) {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(state), "utf8");
  } catch {
    // /tmp should always work; ignore if the environment is read-only.
  }
}

function normalizeGrant(grant: Grant): Grant {
  const incoming = grant as unknown as { status: string };
  const status = (
    incoming.status === "proposed" ? "pending" : incoming.status
  ) as Grant["status"];
  return {
    ...grant,
    issuer: grant.issuer || "P-lin-demo",
    subject: grant.subject || "P-lin-demo",
    audience: grant.audience || audienceOfAgency(grant.agencyId),
    source: grant.source || "mydata",
    expiresAt: grant.expiresAt || expiresAtFrom(grant.proposedAt),
    status,
    revokeOn: grant.revokeOn || "submitted",
  };
}

function hydrateState(state: DemoState): DemoState {
  if (!state.vaultHoldings?.length) {
    state.vaultHoldings = buildVaultHoldings();
  }
  state.grants = (state.grants ?? []).map(normalizeGrant);
  return state;
}

export function getState(): DemoState {
  if (memory) {
    return hydrateState(memory);
  }
  try {
    if (existsSync(STORE_PATH)) {
      memory = hydrateState(JSON.parse(readFileSync(STORE_PATH, "utf8")) as DemoState);
      return memory;
    }
  } catch {
    memory = null;
  }
  memory = createInitialState();
  persist(memory);
  return memory;
}

export function mutate(fn: (state: DemoState) => void): DemoState {
  const state = getState();
  fn(state);
  persist(state);
  return state;
}

export function resetState(): DemoState {
  memory = createInitialState();
  persist(memory);
  return memory;
}

export function appendAudit(
  state: DemoState,
  input: {
    actor: string;
    actorRole: AuditEntry["actorRole"];
    action: AuditAction;
    grantId?: GrantId | null;
    detail: string;
    deniedFields?: FieldId[];
  },
): AuditEntry {
  const entry: AuditEntry = {
    id: id("aud"),
    at: nowIso(),
    actor: input.actor,
    actorRole: input.actorRole,
    action: input.action,
    grantId: input.grantId ?? null,
    detail: input.detail,
    deniedFields: input.deniedFields,
  };
  state.audit.push(entry);
  return entry;
}

export function appendChat(
  state: DemoState,
  role: ChatMessage["role"],
  text: string,
): ChatMessage {
  const msg: ChatMessage = { id: id("msg"), role, text, at: nowIso() };
  state.chat.push(msg);
  return msg;
}

export function grantById(state: DemoState, grantId: string) {
  return state.grants.find((g) => g.id === grantId) ?? null;
}

export function agencyOf(grantId: GrantId): AgencyId {
  return grantId === "G-甲" ? "jia" : "yi";
}

export { GRANT_FIELDS, nowIso, id };
