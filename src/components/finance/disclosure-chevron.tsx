import { ChevronRight } from 'lucide-react';

/**
 * The affordance for a `<details>` whose `<summary>` is laid out with flex or grid.
 *
 * A summary keeps its native triangle only while it is `display: list-item`. The
 * closed "rests" on Coach (#769 onward) are `flex min-h-11` so they clear the 44px
 * tap floor — and that dropped the triangle, leaving a bold sentence with nothing
 * saying it opens. This is the triangle back, drawn by the summary itself: it turns
 * when the parent `<details>` is open, read off the DOM state (`details[open]`)
 * rather than React state, so it is right before hydration and for a UA-initiated
 * toggle (find-in-page, an anchor) alike.
 *
 * The variant is anchored on `details[open] > summary`, so a closed disclosure
 * nested in an open one keeps its own chevron closed.
 */
export function DisclosureChevron({ className = '' }: { className?: string }) {
  return (
    <ChevronRight
      aria-hidden
      data-testid="disclosure-chevron"
      className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none [details[open]>summary_&]:rotate-90 ${className}`}
    />
  );
}

/**
 * Summary classes for a closed rest that carries a `DisclosureChevron`: the 44px
 * floor the Coach rests already use, plus the WebKit marker reset so Safari cannot
 * draw its own triangle beside ours.
 */
export const DISCLOSURE_SUMMARY_CLASS =
  'flex min-h-11 cursor-pointer select-none items-center gap-1.5 [&::-webkit-details-marker]:hidden';
