export function FallbackCard({ kind }: { kind: string }) {
  return (
    <div className="rounded-[28px] bg-[var(--wash-orchid)] px-6 py-5">
      <p className="text-[13px] leading-6 text-stone-500">
        這個版本還不會顯示「{kind}」這種卡片。
      </p>
    </div>
  );
}
