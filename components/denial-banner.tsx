export function DenialBanner({ reason }: { reason: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border-2 border-red-800 bg-red-50 px-3 py-3 text-red-950"
    >
      <p className="font-serif text-[28px] leading-none font-bold tracking-tight">403</p>
      <p className="mt-2 text-sm leading-5 font-medium">{reason}</p>
    </div>
  );
}
