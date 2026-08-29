"use client";

import { useCallback, useState } from "react";
import { GRANT_HTTP_TOKEN } from "@/lib/fields";
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

export function useDemo(initialState: DemoState) {
  const [state, setState] = useState<DemoState>(initialState);
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
    async (input: {
      grantId: GrantId;
      fields: string[];
      actor: string;
    }) => {
      setBusy(true);
      try {
        const res = await fetch("/api/mydata/fetch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer Grant ${GRANT_HTTP_TOKEN[input.grantId]}`,
          },
          body: JSON.stringify({
            fields: input.fields,
            actor: input.actor,
          }),
        });
        return await apply(res);
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const submit = useCallback(
    async (grantId: GrantId, actor: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/applications/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grantId, actor }),
        });
        return await apply(res);
      } finally {
        setBusy(false);
      }
    },
    [apply],
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
