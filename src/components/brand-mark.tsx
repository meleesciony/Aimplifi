/**
 * Wordmark mark — a small geometric sprout, not a second logo system.
 * Used next to the word “Aimplifi” so the brand is a mark + word, not a colored syllable.
 */
export function BrandMark({ className = 'size-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      data-testid="brand-mark"
    >
      <rect width="24" height="24" rx="7" className="fill-brand-500" />
      <path
        d="M12 5.5 7 16h3.1l.7-2h2.4l.7 2H17L12 5.5Zm0 4.4 0.7 2h-1.4l.7-2Z"
        className="fill-white"
      />
    </svg>
  );
}
