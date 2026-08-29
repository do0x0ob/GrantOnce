import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomId } from "./crypto";
import { FIELD_META } from "./fields";
import { AGENCY_NAMES } from "./parties";
import { PURPOSES } from "./purposes";
import type {
  AgencyId,
  AuditEntry,
  ChatMessage,
  DemoState,
  GrantId,
  Notification,
} from "./types";
import { FIELD_IDS } from "./types";

const STORE_PATH = process.env.GRANTONCE_STORE ?? "/tmp/grantonce-runtime.json";
/** Bump when DemoState changes shape. A file from an older build is discarded. */
const STORE_VERSION = 2;
export function nowIso(): string {
  return new Date().toISOString();
}
function emptyInbox(agencyId: AgencyId): DemoState["inboxes"][AgencyId] {
  const purpose =
    agencyId === "jia" ? PURPOSES["childcare-allowance"] : PURPOSES["aircon-subsidy"];
  return {
    agencyId,
    name: AGENCY_NAMES[agencyId],
    programTitle: purpose.title,
    purpose: purpose.id,
    claims: [],
    grantDigest: null,
    receivedAt: null,
    submittedAt: null,
    lastDenial: null,
    lastDeniedAt: null,
  };
}
export function createInitialState(): DemoState {
  const at = nowIso();
  return {
    version: STORE_VERSION,
    principal: {
      id: "P-lin-demo",
      name: "林曉晴",
      summary: "合成演示身分：剛從臺北市遷到新北市，家中有一歲幼兒。",
      synthetic: true,
      key: { publicKey: null, method: null, registeredAt: null, credentialId: null },
    },
    vaultCatalog: FIELD_IDS.map((fieldId) => ({
      fieldId,
      label: FIELD_META[fieldId].label,
      group: FIELD_META[fieldId].group,
      sealed: Boolean(FIELD_META[fieldId].sealed),
      note: FIELD_META[fieldId].note,
    })),
    wallet: [],
    grants: [],
    inboxes: { jia: emptyInbox("jia"), yi: emptyInbox("yi") },
    usedJti: [],
    delegation: {
      active: true,
      agencies: ["jia", "yi"],
      purposes: ["childcare-allowance", "aircon-subsidy"],
      // Default ceiling stops at pairwise pseudonyms: raw personal data needs an
      // explicit widening by the principal, it is never the default.
      maxSensitivity: "pseudonym",
      grantTtlSeconds: 600,
      validUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      revokedAt: null,
      revokedReason: null,
    },
    notifications: [],
    audit: [],
    chat: [
      {
        id: "welcome",
        role: "agent",
        at,
        text:
          "我是補助代理人。資格用規則引擎比對；能不能取得資料，要兩把鑰匙同時轉：你的簽章，加上機關的法定職務範圍。\n\n先在左欄註冊你的簽章金鑰，再輸入：「我剛搬家，看我能申請什麼。」",
      },
    ],
    plan: null,
    clockOffsetDays: 0,
  };
}
let memory: DemoState | null = null;
let loadedMtimeMs = 0;
/** Atomic enough for a single machine: write a sibling temp file, then rename. */
function persist(state: DemoState) {
  try {
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    const tmp = `${STORE_PATH}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, STORE_PATH);
    loadedMtimeMs = statSync(STORE_PATH).mtimeMs;
  } catch (error) {
    console.error("[grantonce] persist failed", error);
  }
}
/**
 * A store written by an older build has a different shape, and every reader here
 * would crash on it. Reject the whole file rather than half-load it.
 */
function isCurrentSchema(value: unknown): value is DemoState {
  const s = value as Partial<DemoState> | null;
  return Boolean(
    s &&
      s.version === STORE_VERSION &&
      s.principal?.key &&
      Array.isArray(s.grants) &&
      Array.isArray(s.wallet) &&
      Array.isArray(s.audit) &&
      Array.isArray(s.usedJti) &&
      Array.isArray(s.vaultCatalog) &&
      s.inboxes?.jia &&
      s.inboxes?.yi &&
      s.delegation,
  );
}
function diskMtime(): number {
  try {
    return existsSync(STORE_PATH) ? statSync(STORE_PATH).mtimeMs : 0;
  } catch {
    return 0;
  }
}
/**
 * Re-reads the file whenever another process has written it.
 *
 * The web app and the MCP server share one store; caching it in memory forever
 * made the two diverge silently and clobber each other.
 */
export function getState(): DemoState {
  const mtime = diskMtime();
  if (memory && mtime && mtime === loadedMtimeMs) return memory;
  if (memory && !mtime) return memory;
  if (mtime) {
    try {
      const parsed = JSON.parse(readFileSync(STORE_PATH, "utf8")) as DemoState;
      if (!isCurrentSchema(parsed)) {
        throw new Error(
          `store schema is v${(parsed as { version?: number })?.version ?? 0}, expected v${STORE_VERSION}`,
        );
      }
      memory = parsed;
      loadedMtimeMs = mtime;
      return memory;
    } catch (error) {
      // Never silently reset: a corrupt store would erase the audit trail.
      const quarantine = `${STORE_PATH}.corrupt-${Date.now()}`;
      try {
        renameSync(STORE_PATH, quarantine);
      } catch {
        // best effort
      }
      console.error(
        `[grantonce] store unusable, moved to ${quarantine}; starting fresh`,
        error,
      );
    }
  }
  memory = createInitialState();
  persist(memory);
  return memory;
}
const LOCK_PATH = `${STORE_PATH}.lock`;
const LOCK_TIMEOUT_MS = 3000;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

/** Blocks the thread briefly; the critical section is a few file operations. */
function pause(ms: number) {
  Atomics.wait(sleeper, 0, 0, ms);
}

/**
 * Cross-process mutual exclusion around read-modify-write.
 *
 * The web app and the MCP server share one store, so without this every
 * status and jti guard is a check-then-act race: two processes both read a
 * signed grant, both find its jti unused, and both redeem it. Audit entries
 * were lost the same way.
 */
function withLock<T>(fn: () => T): T {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd: number | null = null;

  while (fd === null) {
    try {
      mkdirSync(dirname(LOCK_PATH), { recursive: true });
      fd = openSync(LOCK_PATH, "wx");
    } catch {
      if (Date.now() > deadline) {
        // The holder died mid-section. Break the lock rather than deadlock the demo.
        try {
          unlinkSync(LOCK_PATH);
        } catch {
          // someone else got there first
        }
        continue;
      }
      pause(2);
    }
  }

  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
      unlinkSync(LOCK_PATH);
    } catch {
      // already released
    }
  }
}

export function mutate(fn: (state: DemoState) => void): DemoState {
  return withLock(() => {
    // Re-read inside the lock: a state cached before another process wrote is
    // exactly what makes the read-modify-write lossy.
    memory = null;
    loadedMtimeMs = 0;
    const state = getState();
    fn(state);
    persist(state);
    return state;
  });
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
    action: AuditEntry["action"];
    grantId?: GrantId | null;
    detail: string;
    deniedClaims?: string[];
    risk?: AuditEntry["risk"];
  },
): AuditEntry {
  const entry: AuditEntry = {
    id: randomId("aud"),
    at: nowIso(),
    actor: input.actor,
    actorRole: input.actorRole,
    action: input.action,
    grantId: input.grantId ?? null,
    detail: input.detail,
    deniedClaims: input.deniedClaims,
    risk: input.risk,
  };
  state.audit.push(entry);
  return entry;
}
export function appendChat(
  state: DemoState,
  role: ChatMessage["role"],
  text: string,
): ChatMessage {
  const msg: ChatMessage = { id: randomId("msg"), role, text, at: nowIso() };
  state.chat.push(msg);
  return msg;
}
export function notify(
  state: DemoState,
  input: Omit<Notification, "id" | "at" | "acknowledged">,
): Notification {
  const n: Notification = {
    ...input,
    id: randomId("ntf"),
    at: nowIso(),
    acknowledged: false,
  };
  state.notifications.push(n);
  appendAudit(state, {
    actor: "補助代理人",
    actorRole: "agent",
    action: "notify",
    grantId: input.grantId,
    detail: `主動推送：${input.title}`,
  });
  return n;
}
export function grantById(state: DemoState, grantId: string) {
  return state.grants.find((g) => g.id === grantId) ?? null;
}
export function agencyOf(grantId: GrantId): AgencyId {
  return grantId === "G-甲" ? "jia" : "yi";
}
