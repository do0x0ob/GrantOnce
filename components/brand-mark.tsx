/** Two keys, drawn as two interlocking rings. Quiet enough for a header. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={className ?? "size-8"}
    >
      <circle
        cx="12.5"
        cy="16"
        r="7.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <circle
        cx="19.5"
        cy="16"
        r="7.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}
