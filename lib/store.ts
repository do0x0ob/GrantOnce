import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FIELD_META, GRANT_FIELDS } from "./fields";
import { HAPPY_PATH_UTTERANCE } from "./rules";
import type {
  AgencyId,
  AuditAction,
  AuditEntry,
  ChatMessage,
  DemoState,
  FieldId,
  GrantId,
} from "./types";
import { FIELD_IDS } from "./types";

const STORE_PATH = process.env.GRANTONCE_STORE ?? "/tmp/grantonce-runtime.json";

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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
    grants: [],
    envelopes: {
      "G-甲": { grantId: "G-甲", agencyId: "jia", fields: {}, fetchedAt: null },
      "G-乙": { grantId: "G-乙", agencyId: "yi", fields: {}, fetchedAt: null },
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

export function getState(): DemoState {
  if (memory) return memory;
  try {
    if (existsSync(STORE_PATH)) {
      memory = JSON.parse(readFileSync(STORE_PATH, "utf8")) as DemoState;
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
