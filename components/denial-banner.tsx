export function DenialBanner({ reason }: { reason: string }) {
  return (
    <div role="alert" className="rounded-[20px] bg-rose-50 px-4 py-3 text-rose-950">
      <p className="text-[28px] leading-none font-semibold tracking-tight">403</p>
      <p className="mt-2 text-[13px] leading-5">{reason}</p>
    </div>
  );
}
