import { PieChart } from 'lucide-react';
import { cents, formatCents } from '@/lib/money';
import { formatMonth } from '@/lib/dates';
import type { SpendingBreakdown } from '@/lib/engine/reports/reports';
import type { CategoryBreakdown } from '@/lib/engine/glass-box/category-breakdown';
import { CategoryBreakdownPanel } from '@/components/finance/category-breakdown-panel';
import { reportsNotCountedYetCopy } from '@/lib/engine/glass-box/category-breakdown';
import { TrackedActedLink } from '@/components/engagement/tracked-acted-link';
import { SURFACE_CARD_CLASS } from '@/components/finance/surface-card-styles';
import { CHART_SERIES } from '@/lib/ui/chart-colors';

const PALETTE = CHART_SERIES;

/**
 * Dashboard summary of this month's top spending categories (DECISIONS #67).
 *
 * O.18 — the whole card used to be one `<a href="/reports">`, and that is why it
 * was the one category table on the dashboard whose rows could not expand: a
 * `<button>` inside an anchor is invalid HTML and the anchor swallows its
 * clicks. It was filed as a deliberate refusal (TASKS O.18a) on the grounds that
 * the card is a summary that links through — and a critic pointed out that the
 * owner's words were "every table", that this is a table with figures, and that
 * `getReports` was already computing these rows' breakdowns and throwing them
 * away.
 *
 * So the anchor moved instead of the expanders being dropped. The whole-card tap
 * became a header link ("Top spending →"), which is the smallest change that
 * frees the rows: the destination, the engagement subject key and the visual
 * layout are all unchanged, and the reader keeps a one-tap route to /reports.
 */
export function TopSpendingCard({
  breakdown,
  breakdowns,
  /** The month these figures cover — the panel may not assume "this month". */
  ym,
  notCountedYetCents,
}: {
  breakdown: SpendingBreakdown;
  /**
   * The rows behind each category, keyed by id. REQUIRED: `getReports` already
   * builds them for every category, so an optional prop here would only make it
   * possible to render this card with dead rows.
   */
  breakdowns: Record<string, CategoryBreakdown>;
  ym: string;
  /**
   * The money this card's window held back (C.26 critic cycle 2, F3).
   *
   * REQUIRED, and the reason is the executed finding: this card inherited the
   * stop-at-today clamp from `getReports` and none of its disclosure, so a
   * reader whose only June charge was dated later in June met "$0.00 this
   * month" and "No spending yet this month." over $400.00 of posted charges,
   * under a label claiming the whole month. Its panels cannot carry the
   * per-category sentence in that state — the categories the clamp emptied are
   * dropped before a panel exists. A defaulted prop would have let the next
   * surface repeat it silently.
   */
  notCountedYetCents: number;
}) {
  const top = breakdown.byCategory.slice(0, 4);
  // O.19a (owner report 2026-07-31): the header prints `totalCents` — the WHOLE
  // month — beside four rows, so the card's own numbers did not add up on
  // screen. The remainder is summed from the same array the header total sums;
  // the card stays a summary and /reports (linked in the header) holds the
  // full, expandable list.
  const rest = breakdown.byCategory.slice(4);
  const restCents = rest.reduce((s, c) => s + c.amountCents, 0);
  const max = Math.max(1, ...top.map((c) => c.amountCents));
  return (
    <section className={SURFACE_CARD_CLASS} data-testid="dashboard-top-spending">
      <div className="flex items-baseline justify-between">
        <TrackedActedLink
          href="/reports"
          subjectKey="top-spending"
          data-testid="dashboard-top-spending-link"
          className="flex items-center gap-2 rounded-sm text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <PieChart className="size-3.5" aria-hidden /> Top spending →
        </TrackedActedLink>
        <span className="tabular-nums text-xs text-muted-foreground">
          {formatCents(cents(breakdown.totalCents))}{' '}
          {notCountedYetCents > 0 ? 'so far this month' : 'this month'}
        </span>
      </div>
      {notCountedYetCents > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground" data-testid="top-spending-not-counted-yet">
          {reportsNotCountedYetCopy(formatCents(cents(notCountedYetCents)))}
        </p>
      ) : null}
      {top.length === 0 ? (
        <p className="py-5 text-center text-xs text-muted-foreground">
          {notCountedYetCents > 0 ? 'Nothing counted yet this month.' : 'No spending yet this month.'}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {top.map((c, i) => (
            <div key={c.categoryId}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="min-w-0 truncate">{c.name}</span>
                <span className="ml-2 shrink-0 tabular-nums text-muted-foreground">
                  {formatCents(cents(c.amountCents))}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${(c.amountCents / max) * 100}%`, backgroundColor: PALETTE[i % PALETTE.length] }}
                />
              </div>
              {/* No register link passed: this card prints no `linkable` set, and
                  O.5 refuses a href it cannot fence. The panel's rows still each
                  link to their own detail view, and the header still reaches
                  /reports, where the same category carries the full drill-down. */}
              <CategoryBreakdownPanel
                breakdown={breakdowns[c.categoryId]}
                categoryName={c.name}
                // NOT narrowed here (critic cycle 3, G1): the panel applies
                // `windowLabelSoFar` with its OWN category's held-back amount.
                // Narrowing with the PAGE amount first produced "Jun 2026 so
                // far so far" for any category with money dated ahead, and
                // labelled a category that held back nothing "so far" — a
                // panel's label describes its own figure's window, which is
                // the property that lets two panels on one page differ.
                windowLabel={formatMonth(ym)}
                testIdPrefix="top-spending-breakdown"
              />
            </div>
          ))}
          {rest.length > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="top-spending-rest">
              + {formatCents(cents(restCents))} across {rest.length} more categor
              {rest.length === 1 ? 'y' : 'ies'} — the full list is in Reports.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
