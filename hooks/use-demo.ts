"use client";

import { useCallback, useState } from "react";
import type { DemoState, GrantId } from "@/lib/types";

type ActionResult = {
  ok: boolean;
  error?: string;
  denied?: boolean;
};

async function readPayload(res: Response): Promise<{ state?: DemoState; error?: string }> {
  const data = (await res.json()) as DemoState & { error?: string; state?: DemoState };
  if (data && "grants" in data && Array.isArray(data.grants)) {
    return { state: data, error: data.error };
  }
  return { state: data.state, error: data.error };
}

function ticketFor(state: DemoState, grantId: GrantId): string | null {
  return state.grants.find((grant) => grant.id === grantId)?.ticket ?? null;
}

export function useDemo(initialState: DemoState) {
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(async (res: Response): Promise<ActionResult> => {
    const { state: next, error: message } = await readPayload(res);
    if (next) setState(next);
    if (!res.ok) {
      const text = message ?? `請求失敗（${res.status}）`;
      setError(res.status === 403 ? null : text);
      return { ok: false, error: text, denied: res.status === 403 };
    }
    setError(null);
    return { ok: true };
  }, []);

  const sendChat = useCallback(
    async (message: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        return await apply(res);
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const approve = useCallback(
    async (grantId: GrantId) => {
      setBusy(true);
      try {
        const res = await fetch("/api/grants/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grantId }),
        });
        return await apply(res);
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const revoke = useCallback(
    async (grantId: GrantId) => {
      setBusy(true);
      try {
        const res = await fetch("/api/grants/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grantId }),
        });
        return await apply(res);
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const fetchMyData = useCallback(
    async (input: { grantId: GrantId; fields: string[]; ticket?: string }) => {
      setBusy(true);
      try {
        const token = input.ticket ?? ticketFor(state, input.grantId) ?? input.grantId;
        const res = await fetch("/api/mydata/fetch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer Grant ${token}`,
          },
          body: JSON.stringify({
            fields: input.fields,
          }),
        });
        return await apply(res);
      } finally {
        setBusy(false);
      }
    },
    [apply, state],
  );

  const submit = useCallback(
    async (grantId: GrantId, ticketOverride?: string) => {
      setBusy(true);
      try {
        const ticket = ticketOverride ?? ticketFor(state, grantId) ?? "";
        const res = await fetch("/api/applications/submit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(ticket ? { Authorization: `Bearer Grant ${ticket}` } : {}),
          },
          body: JSON.stringify({ ticket }),
        });
        return await apply(res);
      } finally {
        setBusy(false);
      }
    },
    [apply, state],
  );

  const reset = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      await apply(res);
      setError(null);
    } finally {
      setBusy(false);
    }
  }, [apply]);

  return {
    state,
    busy,
    error,
    sendChat,
    approve,
    revoke,
    fetchMyData,
    submit,
    reset,
  };
}
