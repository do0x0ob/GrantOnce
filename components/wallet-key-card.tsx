"use client";

import { BrandMark } from "@/components/brand-mark";
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
  if (keyState.registered && !localKeyUsable) {
    return (
      <div className={cn(SURFACE, "space-y-4 p-7")}>
        <div className="flex items-center gap-2">
          <p className="text-[16px] leading-6 text-stone-800">這個瀏覽器沒有這把金鑰</p>
          <StatusChip tone="rose">無法簽署</StatusChip>
        </div>
        <p className="text-[15px] leading-7 text-stone-500">
          伺服器登記的公鑰是 {keyState.fingerprint}…，但這個瀏覽器手上沒有對應的私鑰。
          換了網址（localhost 與 127.0.0.1 算兩個來源）、換了裝置或清過資料都會這樣。重新註冊一把即可。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            disabled={busy || !passkeyAvailable}
            onClick={() => onRegister("passkey")}
          >
            重新用 passkey 註冊
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="text-stone-400 hover:text-stone-700"
            disabled={busy}
            onClick={() => onRegister("software")}
          >
            改用軟體金鑰
          </Button>
        </div>
      </div>
    );
  }

  if (keyState.registered) return null;

  return (
    <div className="flex min-h-[calc(100svh-10rem)] flex-col items-center justify-center px-2 text-center">
      <BrandMark className="size-14 text-stone-800" />
      <h1 className="mt-10 text-[2.25rem] font-medium leading-tight tracking-tight text-stone-900">
        先建立你的簽章金鑰
      </h1>
      <p className="mt-5 max-w-[22rem] text-[17px] leading-8 text-stone-500">
        兩把鑰匙才開得了：你的簽章，加上機關的法定職務。
      </p>
      <div className="mt-10 flex w-full max-w-xs flex-col gap-3">
        <Button
          size="xl"
          disabled={busy || !passkeyAvailable}
          onClick={() => onRegister("passkey")}
        >
          用 passkey 建立
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="text-stone-400 hover:text-stone-700"
          disabled={busy}
          onClick={() => onRegister("software")}
        >
          改用軟體金鑰
        </Button>
      </div>
      <p
        className={cn(
          "mt-10 max-w-[22rem] text-[13px] leading-6",
          passkeyAvailable ? "text-stone-400" : "text-[var(--clay)]",
        )}
      >
        {passkeyAvailable
          ? "金鑰由 passkey 派生，簽完即丟，伺服器只有公鑰。認證器若不支援 PRF，請改用軟體金鑰。"
          : `${passkeyProblem ?? "無法使用 passkey"}。目前請用軟體金鑰。`}
      </p>
    </div>
  );
}
