"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import type { Sensitivity } from "@/lib/claims";
import {
  localPublicKey,
  passkeyBlocker,
  passkeySupported,
  registerPasskey,
  registerSoftwareKey,
  signGrantBytes,
} from "@/lib/passkey";
import type { AgencyId, ApplicationStatus, GrantId } from "@/lib/types";
import type { PrincipalView } from "@/lib/view";

type ActionResult = { ok: boolean; error?: string };

/** The platform capability never changes within a session. */
const subscribeNever = () => () => {};

function isView(data: unknown): data is PrincipalView {
  return Boolean(data && typeof data === "object" && "grants" in data && "delegation" in data);
}

export function useDemo(initialView: PrincipalView) {
  const [view, setView] = useState<PrincipalView>(initialView);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `window.PublicKeyCredential` does not exist during SSR, so this is read
  // through a store with an explicit server snapshot rather than branched on
  // during render, which would be a hydration mismatch.
  const passkeyAvailable = useSyncExternalStore(subscribeNever, passkeySupported, () => false);
  const passkeyProblem = useSyncExternalStore(subscribeNever, passkeyBlocker, () => null);
  const browserKey = useSyncExternalStore(subscribeNever, localPublicKey, () => null);

  const apply = useCallback(async (res: Response): Promise<ActionResult> => {
    const data = (await res.json()) as PrincipalView & { error?: string };
    if (isView(data)) setView(data);
    if (!res.ok) {
      const text = data?.error ?? `請求失敗（${res.status}）`;
      // 403 is a designed outcome here, not a crash: the pane shows the reason.
      setError(res.status === 403 ? null : text);
      return { ok: false, error: text };
    }
    setError(null);
    return { ok: true };
  }, []);

  /**
   * The user's own line appears the moment they send it.
   *
   * A turn can take several seconds when the classifier is consulted, and until
   * the response lands the view is whatever the server last returned — so
   * without this the message you just typed simply is not there, which reads as
   * the button having done nothing.
   */
  const sendChat = useCallback(
    async (message: string): Promise<ActionResult> => {
      setView((current) => ({
        ...current,
        chat: [
          ...current.chat,
          {
            id: `pending:${Date.now()}`,
            role: "user" as const,
            text: message,
            at: new Date().toISOString(),
          },
        ],
      }));
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        return await apply(res);
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        setError(text);
        return { ok: false, error: text };
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const post = useCallback(
    async (url: string, body?: unknown): Promise<ActionResult> => {
      setBusy(true);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return await apply(res);
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        setError(text);
        return { ok: false, error: text };
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const registerKey = useCallback(
    async (mode: "passkey" | "software"): Promise<ActionResult> => {
      setBusy(true);
      setError(null);
      try {
        const key =
          mode === "passkey" ? await registerPasskey("林曉晴（合成身分）") : registerSoftwareKey();
        const res = await fetch("/api/wallet/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(key),
        });
        return await apply(res);
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        setError(text);
        return { ok: false, error: text };
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  /**
   * Signing happens in the browser, over the exact serialized grant the server
   * sent. The private key is re-derived from the authenticator for this one
   * signature and never leaves the page.
   */
  const signGrant = useCallback(
    async (grantId: GrantId): Promise<ActionResult> => {
      const grant = view.grants.find((g) => g.id === grantId);
      const method = view.principal.key.method;
      const publicKey = view.principal.key.publicKey;
      if (!grant) return { ok: false, error: "找不到這張匣" };
      if (!method || !publicKey) return { ok: false, error: "請先註冊簽章金鑰" };

      setBusy(true);
      setError(null);
      try {
        const signature = await signGrantBytes(method, grant.serialized);
        const res = await fetch("/api/grants/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grantId, signature, publicKey }),
        });
        return await apply(res);
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        setError(text);
        return { ok: false, error: text };
      } finally {
        setBusy(false);
      }
    },
    [apply, view],
  );

  return {
    view,
    busy,
    error,
    passkeyAvailable,
    passkeyProblem,
    // Registered on the server AND signable from this browser.
    localKeyUsable: !view.principal.key.registered || browserKey === view.principal.key.publicKey,
    registerKey,
    signGrant,
    sendChat,
    redeem: (grantId: GrantId, agency: AgencyId) =>
      post("/api/grants/redeem", { grantId, agency }),
    revoke: (grantId: GrantId) => post("/api/grants/revoke", { grantId }),
    submit: (grantId: GrantId) => post("/api/applications/submit", { grantId }),
    requestClaims: (agency: AgencyId, purpose: string, claims: string[]) =>
      post("/api/agency/request", { agency, purpose, claims }),
    stopDelegation: () => post("/api/delegation", { action: "revoke", reason: "委託人在演示中停止委託" }),
    restoreDelegation: () => post("/api/delegation", { action: "restore" }),
    setMaxSensitivity: (maxSensitivity: Sensitivity) =>
      post("/api/delegation", { action: "update", maxSensitivity }),
    setClock: (offsetDays: number) => post("/api/clock", { offsetDays }),
    scanNotifications: () => post("/api/notifications"),
    acknowledge: (id: string) => post("/api/notifications/ack", { id }),
    advanceApplication: (purpose: string, status: ApplicationStatus) =>
      post("/api/agency/advance", { purpose, status }),
    reset: () => post("/api/reset"),
    upsertPurpose: (purpose: {
      id: string;
      title: string;
      agency: string;
      privacyBasis: string[];
      allowedClaims: string[];
      maxTtlSeconds: number;
      necessity: string;
      retentionPolicy: string;
      processingArea: string;
      processingMethod: string;
      declineEffect: string;
    }) => post("/api/state", { action: "registry.upsert", purpose }),
    retirePurpose: (id: string) => post("/api/state", { action: "registry.retire", id }),
  };
}

export type Demo = ReturnType<typeof useDemo>;
