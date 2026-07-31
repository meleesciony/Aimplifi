'use client';

/**
 * The expandable half of a category row — "show me what is in this bucket".
 *
 * Owner request, 2026-07-31: *"I've asked you many times to make rows expandable
 * so I can see what exactly system is classifying spending as. Not just the
 * stuff in the photo but every table."*
 *
 * Why this exists when every one of those rows ALREADY links to the register
 * (O.5/O.6): a link is a different gesture with a different cost. It leaves the
 * page, loses the table the reader was comparing rows in, and answers the
 * question one category at a time. The question being asked here — "is this
 * bucket right?" — is answered by scanning several buckets in a row, which only
 * works if the answer opens in place. Both affordances ship: the panel shows
 * what is inside, its footer still offers the register, which is where a row can
 * be re-filed.
 *
 * Every value rendered here comes from a `CategoryBreakdown` built by
 * `engine/glass-box/category-breakdown.ts` out of the same array the figure was
 * summed from. Nothing is recomputed in this file, and nothing is fetched: the
 * rows are already on the page when it paints, so expanding cannot show a
 * different month, a different basis, or a newer set of rows than the figure
 * above it was computed from.
 */
import Link from 'next/link';
import { useId, useState } from 'react';
import {
  BREAKDOWN_BASIS,
  breakdownEmptyCopy,
  breakdownNetRefundCopy,
  type CategoryBreakdown,
} from '@/lib/engine/glass-box/category-breakdown';
import { formatISODate, isoDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';

export function CategoryBreakdownPanel({
  breakdown,
  categoryName,
  /**
   * The period these rows cover, as the reader would say it ("Jul 2026").
   *
   * REQUIRED. Two independent critics found the same defect here: the copy used
   * to say "this month", which is true on /budgets and /reports and false on
   * /trends, whose panels describe the last COMPLETE month while the card above
   * them is headed with the current one. The window is a fact about the surface,
   * so the surface has to say it.
   */
  windowLabel,
  /** Where "open these in the register" goes, or null where O.5 refuses a link. */
  registerHref,
  /** Distinguishes this panel's test ids on pages that render several tables. */
  testIdPrefix = 'breakdown',
  /**
   * EXTRA sentences for this surface only. The shared basis (`BREAKDOWN_BASIS`)
   * is printed by this component whether or not a caller passes anything, so a
   * surface cannot ship a panel with no disclosure by forgetting the prop.
   */
  basis = [],
}: {
  breakdown: CategoryBreakdown;
  categoryName: string;
  windowLabel: string;
  registerHref?: string | null;
  testIdPrefix?: string;
  basis?: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  /**
   * Rows are mounted on FIRST open and then kept, so a collapsed panel costs one
   * empty `<div>` instead of its whole row list.
   *
   * This is a DOM-weight decision, not a data one: the rows are already in the
   * page's payload either way (that is what makes the panel a reshaping of the
   * figure's own array rather than a fetch, and it is the property the whole
   * feature rests on). But /budgets renders every category at once, and every
   * transaction of the month belongs to exactly one of them — so mounting them
   * all eagerly puts the entire month in the DOM of a phone that may open none
   * of them.
   *
   * The container `<div>` stays mounted regardless so `aria-controls` always
   * resolves to a real element; only its contents are deferred. Keeping them
   * after a close means reopening is instant and any scroll position inside a
   * long list survives.
   */
  const [everOpened, setEverOpened] = useState(false);
  const panelId = useId();
  const { rows, categoryId } = breakdown;
  const count = rows.length;

  /**
   * The visible text on the control, spelled out rather than abbreviated.
   *
   * A bare "14 items" was the first draft and it repeats a mistake this repo has
   * already paid for twice: an affordance the reader cannot recognise is
   * indistinguishable from one that was never built (the measurement recorded in
   * `CATEGORY_LINK_CLASS` — no underline, no colour delta, and `:hover` does not
   * exist on a phone). This control sits below a row that already carries two
   * links, so it says what it does, in a bordered chip that reads as a button.
   *
   * The zero case gets its own words instead of "Show 0 transactions", because
   * on /trends a category that fell to nothing is a row the reader specifically
   * wants explained, and the panel behind it holds the explanation.
   */
  const visibleLabel = open
    ? 'Hide'
    : count === 0
      ? 'Nothing filed here — see why'
      : `Show ${count} transaction${count === 1 ? '' : 's'}`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setEverOpened(true);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-controls={panelId}
        // WCAG 2.5.3: the accessible name must CONTAIN the visible string, so the
        // category is a prefix on it rather than a replacement for it.
        aria-label={`${categoryName}: ${visibleLabel}`}
        data-testid={`${testIdPrefix}-toggle-${categoryId}`}
        className="mt-1 inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span aria-hidden="true" className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>
          ›
        </span>
        <span>{visibleLabel}</span>
      </button>

      <div
        id={panelId}
        hidden={!open}
        role="region"
        aria-label={`Transactions in ${categoryName}`}
        data-testid={`${testIdPrefix}-panel-${categoryId}`}
        className="mt-1.5 rounded-xl border bg-muted/40 p-2.5"
      >
        {!everOpened ? null : count === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid={`${testIdPrefix}-empty-${categoryId}`}>
            {breakdownEmptyCopy(windowLabel)}
          </p>
        ) : (
          <ul className="divide-y" data-testid={`${testIdPrefix}-rows-${categoryId}`}>
            {rows.map((r) => (
              <li key={r.key} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                {/* `min-w-0` alone does not contain an UNBREAKABLE payee name: it
                    lets the flex item shrink, but a single 40-character token has
                    no wrap opportunity inside it, so it paints straight out of the
                    row and through the amount column (measured at 360px: an anchor
                    ending at x=466). `break-words` gives the token somewhere to
                    break — chosen over `truncate` because a clipped payee name is
                    exactly the string a reader opened this panel to read. The
                    amount stays `shrink-0`, so it is the text that yields.
                    The document-level M.1 gate cannot see any of this: it measures
                    a passively-loaded page and these rows live behind a tap. */}
                <span className="min-w-0 break-words">
                  <span className="text-xs text-muted-foreground">{formatISODate(isoDate(r.date))}</span>{' '}
                  {r.transactionId ? (
                    <Link
                      href={`/transactions/${encodeURIComponent(r.transactionId)}`}
                      className="rounded-sm underline decoration-dotted decoration-muted-foreground/70 underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {r.label}
                    </Link>
                  ) : (
                    r.label
                  )}
                  {r.isPending && (
                    <span className="ml-1.5 text-xs text-muted-foreground">(pending)</span>
                  )}
                  {/* The bank's own text, when the payee name has cleaned it up.
                      This is the line the question is actually about: it is what
                      the categorizer read before deciding on this bucket. */}
                  {r.rawDescriptor && (
                    <span className="mt-0.5 block break-words text-xs text-muted-foreground/80">
                      {r.rawDescriptor}
                    </span>
                  )}
                </span>
                <span
                  className="shrink-0 whitespace-nowrap tabular-nums"
                  data-testid={`${testIdPrefix}-row-amount`}
                >
                  {formatCents(r.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {count > 0 && (
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-1.5 text-sm font-semibold">
            <span>Total</span>
            <span className="tabular-nums" data-testid={`${testIdPrefix}-sum-${categoryId}`}>
              {formatCents(breakdown.sumCents)}
            </span>
          </div>
        )}

        {/* The same fail-loud contract the Glass-Box panel carries: these rows
            were selected by the predicate that produced the figure, so a
            mismatch means something upstream is inconsistent and the reader is
            told, rather than shown a shorter list under a bigger number. */}
        {count > 0 &&
          (breakdown.reconciles ? (
            <p
              className="mt-1.5 text-xs font-normal text-muted-foreground"
              data-testid={`${testIdPrefix}-reconciled-${categoryId}`}
            >
              {count === 1 ? 'This row adds' : `These ${count} rows add`} up to exactly{' '}
              {formatCents(breakdown.headlineCents)} — matched to the penny.
            </p>
          ) : breakdown.clampedByNetRefund ? (
            /* Not a mismatch to apologise for — a documented clamp. Saying
               "we can't reconcile this" here would report a defect where the
               engines are doing exactly what they say, and would leave the
               reader with no idea why a category with real rows reads $0.00. */
            <p
              className="mt-1.5 text-xs font-normal text-muted-foreground"
              data-testid={`${testIdPrefix}-net-refund-${categoryId}`}
            >
              {breakdownNetRefundCopy(formatCents(breakdown.sumCents), windowLabel)}
            </p>
          ) : (
            <p
              className="mt-1.5 text-xs font-normal"
              data-testid={`${testIdPrefix}-mismatch-${categoryId}`}
            >
              These rows come to {formatCents(breakdown.sumCents)}, which is not the{' '}
              {formatCents(breakdown.headlineCents)} above. We can&apos;t reconcile that right now,
              and we&apos;d rather say so than hide it.
            </p>
          ))}

        {[BREAKDOWN_BASIS, ...basis].map((b) => (
          <p key={b} className="mt-1 text-xs font-normal text-muted-foreground">
            {b}
          </p>
        ))}

        {registerHref && (
          <Link
            href={registerHref}
            data-testid={`${testIdPrefix}-register-${categoryId}`}
            className="mt-2 inline-block text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Open these in your activity list, where you can re-file one →
          </Link>
        )}
      </div>
    </>
  );
}
