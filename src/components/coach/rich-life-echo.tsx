import { COACH_COPY } from '@/lib/engine/fi/coach-copy';

/**
 * The reader's own Rich Life one-liner, echoed quietly atop /coach (plan P1.3).
 * Rendered ONLY when the reader wrote one — no stored vision, no line, so a
 * "number first, life never" page for someone who never answered the question.
 *
 * The sentence claims only what the page does: every number below is the plan
 * that vision is in service of. It names nothing about how the app surfaces the
 * reader's categories (the plan's "we surface that" was deliberately dropped at
 * C.13 for the same reason as C.14's — those are per-user visible).
 */
export function RichLifeEcho({ vision }: { vision: string | null }) {
  if (!vision) return null;
  return (
    // break-words (critic F4): a valid stored value can be one unbroken token
    // (a 120-char word or a long emoji row) and must wrap inside the ~348px
    // mobile content width — the same overflow class the opportunities row's
    // min-w-0/truncate comment names (coach/page.tsx).
    <p className="break-words text-sm text-muted-foreground" data-testid="rich-life-vision">
      {COACH_COPY.richLifeHeader(vision)}
    </p>
  );
}
