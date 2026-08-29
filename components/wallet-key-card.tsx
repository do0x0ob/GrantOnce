"use client";

import { StatusChip } from "@/components/status-chip";
import { SURFACE } from "@/components/surface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PrincipalView } from "@/lib/view";

export function WalletKeyCard({
  keyState,
  busy,
  passkeyAvailable,
  passkeyProblem,
  localKeyUsable,
  onRegister,
}: {
  keyState: PrincipalView["principal"]["key"];
  busy: boolean;
  passkeyAvailable: boolean;
  passkeyProblem: string | null;
  localKeyUsable: boolean;
  onRegister: (mode: "passkey" | "software") => void;
}) {
  // The server holds only the public half. If this browser has lost the private
  // half — a different origin, a cleared profile, another machine — the wallet
  // reads as registered but cannot actually sign, so say so before the signing
  // button fails.
  if (keyState.registered && !localKeyUsable) {
    return (
      <div className={cn(SURFACE, "space-y-2.5 p-4")}>
        <div className="flex items-center gap-2">
          <p className="text-[13px] leading-5 text-stone-700">這個瀏覽器沒有這把金鑰</p>
          <StatusChip tone="rose">無法簽署</StatusChip>
        </div>
        <p className="text-[12px] leading-5 text-stone-500">
          伺服器登記的公鑰是 {keyState.fingerprint}…，但這個瀏覽器手上沒有對應的私鑰。
          換了網址（localhost 與 127.0.0.1 算兩個來源）、換了裝置或清過資料都會這樣。重新註冊一把即可。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="rounded-full"
            disabled={busy || !passkeyAvailable}
            onClick={() => onRegister("passkey")}
          >
            重新用 passkey 註冊
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full text-stone-400 hover:text-stone-600"
            disabled={busy}
            onClick={() => onRegister("software")}
          >
            改用軟體金鑰
          </Button>
        </div>
      </div>
    );
  }

  if (keyState.registered) {
    return (
      <div className={cn(SURFACE, "flex items-center justify-between gap-3 p-3")}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] leading-5 text-stone-700">皮夾簽章金鑰</p>
            <StatusChip tone={keyState.method === "passkey" ? "mint" : "amber"}>
              {keyState.method === "passkey" ? "passkey · 生物辨識" : "軟體金鑰 · 備援"}
            </StatusChip>
          </div>
          <p className="truncate font-mono text-[11px] leading-4 text-stone-400">
            公鑰 {keyState.fingerprint}…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(SURFACE, "space-y-2.5 p-4")}>
      <p className="text-[13px] leading-5 text-stone-700">先建立你的簽章金鑰</p>
      <p className="text-[12px] leading-5 text-stone-500">
        金鑰由 passkey 的 PRF 擴充派生，每次簽署都要通過 Face ID／指紋才會重新算出來，
        算完即丟。伺服器只拿得到公鑰。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="rounded-full"
          disabled={busy || !passkeyAvailable}
          onClick={() => onRegister("passkey")}
        >
          用 passkey 建立
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full text-stone-400 hover:text-stone-600"
          disabled={busy}
          onClick={() => onRegister("software")}
        >
          改用軟體金鑰
        </Button>
      </div>
      <p
        className={cn(
          "text-[11px] leading-4",
          passkeyAvailable ? "text-stone-400" : "text-amber-600",
        )}
      >
        {passkeyAvailable
          ? "認證器若不支援 PRF，請改用軟體金鑰；流程一樣，只是私鑰改存瀏覽器。"
          : `${passkeyProblem ?? "無法使用 passkey"}。目前請用軟體金鑰。`}
      </p>
    </div>
  );
}
