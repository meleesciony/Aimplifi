'use client';

/**
 * The expandable panel behind a figure — "show me what is in this bucket".
 *
 * Extracted from `category-breakdown-panel.tsx` (O.18) when the /reports CHART
 * needed the same affordance for a different predicate (owner, 2026-08-01:
 * *"every single bar and collection of categories needs to be immediately
 * available"*). Everything here is generic over the SUBJECT — a category, a
 * month's income, a month's spending — and every string that describes a BASIS
 * is a required argument, because the two surfaces disagree about what they
 * count and a shared default would let one of them state the other's rule.
 *
 * That is the one thing this extraction must not lose: `BREAKDOWN_BASIS` used to
 * be printed unconditionally here so a caller could not ship a panel with no
 * disclosure by forgetting a prop.
 *
 * `basis` is therefore typed as a NON-EMPTY tuple, not as `readonly string[]`.
 * The difference is the whole guarantee: a required array argument makes a
 * caller answer, never answer correctly (L.30), and `basis={[]}` would have
 * typechecked, linted and rendered a money panel with no disclosure at all. A
 * critic caught the first draft asserting in this very docblock that requiring
 * the prop was "the same protection" as printing it unconditionally. It is not;
 * the type is.
 *
 * Every value rendered comes from a breakdown built out of the same array the
 * figure was summed from. Nothing is recomputed here and nothing is fetched: the
 * rows are already in the page's payload when it paints, so expanding cannot
 * show a different window, a different basis, or a newer set of rows than the
 * figure above was computed from.
 */
import Link from 'next/link';
import { useId, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { BreakdownRow } from '@/lib/engine/glass-box/category-breakdown';
import { formatISODate, isoDate } from '@/lib/dates';
import { type Cents, formatCents } from '@/lib/money';
import {
  PAGE_RETURNS,
  type PageReturnToken,
  namedPageBack,
  withForwardedReturn,
} from '@/lib/engine/transactions/links';

export interface BreakdownPanelSubject {
  /** Distinguishes this panel's test ids and React keys among its siblings. */
  id: string;
  /** How the reader would name it: a category, or "Spending in Jun 2026". */
  name: string;
  headlineCents: Cents;
  rows: readonly BreakdownRow[];
  sumCents: Cents;
  reconciles: boolean;
  clampedByNetRefund: boolean;
}

export function BreakdownPanel({
  subject,
  /** What the control says when closed and there ARE rows is derived; these two
   *  cover the cases whose wording is surface-specific. */
  emptyToggleLabel = 'Nothing filed here — see why',
  /** Already windowed by the caller — this component never says "this month". */
  emptyCopy,
  /** Already windowed AND already given the sum — see the note on `basis`. */
  netRefundCopy,
  /** REQUIRED and NON-EMPTY: what this panel counts and excludes, one sentence each. */
  basis,
  registerHref = null,
  registerLabel = 'Open these in your activity list, where you can re-file one →',
  testIdPrefix = 'breakdown',
  /**
   * Start expanded.
   *
   * For surfaces where opening the panel IS the reader's gesture — tapping a bar
   * on the /reports chart already means "show me these" — so making them press a
   * second control would be the affordance-that-looks-missing problem again. The
   * caller remounts (a changing `key`) to re-apply it, since this is an initial
   * value rather than a controlled prop.
   */
  defaultOpen = false,
  /**
   * O.20d: constituent panels whose rows all share the SUBJECT's own date — a
   * net-worth point, a forecast day, an allocation segment — must not print
   * that date once per row (the panel's own name already carries it). True for
   * the three constituent surfaces; transaction rows always show their date.
   */
  hideRowDates = false,
  /**
   * What the ROWS are, for the two places the panel names them generically: the
   * toggle's "Show N transaction(s)" and the region's "Transactions in {name}".
   * The O.20d constituent surfaces pass rows that are NOT transactions — account
   * balances (net-worth, allocation) or scheduled flows (forecast) — and the
   * panel's own docblock says every surface-specific string is a required
   * argument precisely because surfaces disagree about what they count (critic
   * P1-2: "Show 3 transactions" over account rows is the same lie at a smaller
   * size). The default keeps every existing call byte-identical.
   */
  rowNoun = 'transaction',
  /**
   * O.20d (critic P2-1): the bar/chip/segment that OPENED this panel derives
   * its aria-expanded from its own selection state, which the panel's inner
   * Hide collapses independently — announcing "expanded" over a hidden panel.
   * The opening surface passes `onToggle` to clear its selection when the
   * panel is collapsed from inside, so the two states can never desync.
   */
  onToggle = null,
}: {
  subject: BreakdownPanelSubject;
  emptyToggleLabel?: string;
  emptyCopy: string;
  netRefundCopy: string;
  // A NON-EMPTY tuple, not `readonly string[]`: `basis={[]}` would otherwise
  // typecheck and render a money panel with no disclosure at all.
  basis: readonly [string, ...string[]];
  registerHref?: string | null;
  registerLabel?: string;
  testIdPrefix?: string;
  defaultOpen?: boolean;
  hideRowDates?: boolean;
  rowNoun?: string;
  onToggle?: ((nowOpen: boolean) => void) | null;
}) {
  const [open, setOpen] = useState(defaultOpen);
  /**
   * Rows are mounted on FIRST open and then kept, so a collapsed panel costs one
   * empty `<div>` instead of its whole row list.
   *
   * A DOM-weight decision, not a data one: the rows are in the page's payload
   * either way (that is what makes this a reshaping of the figure's own array
   * rather than a fetch, and it is the property the whole feature rests on). But
   * /budgets renders every category at once and every transaction of the month
   * belongs to exactly one of them, so mounting them all eagerly puts the whole
   * month in the DOM of a phone that may open none of them.
   *
   * The container `<div>` stays mounted regardless so `aria-controls` always
   * resolves to a real element; only its contents are deferred.
   */
  const [everOpened, setEverOpened] = useState(defaultOpen);
  const panelId = useId();
  const { rows, id, name } = subject;
  const count = rows.length;

  /**
   * C.15 (audit F3) — the reader's place is the PAGE this panel sits on, not the
   * register: a figure drilled on /reports belongs to /reports. The token is
   * the INVERSE of `PAGE_RETURNS` — the same table the decoder validates
   * against, derived here so the two sides cannot drift. A host with no token
   * (nothing renders this panel there today) gets no return context and the far
   * side shows its honest Activity fallback — refusing beats inventing a label.
   * The page's own query (the month on /reports, /budgets, /trends) rides along
   * so a past-month figure returns to that month, not the default one.
   */
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnToken = (Object.keys(PAGE_RETURNS) as PageReturnToken[]).find(
    (t) => PAGE_RETURNS[t].path === pathname,
  );
  const pageQuery = searchParams?.toString() ?? '';

  /**
   * The visible text on the control, spelled out rather than abbreviated.
   *
   * A bare "14 items" was the first draft and it repeats a mistake this repo has
   * already paid for twice: an affordance the reader cannot recognise is
   * indistinguishable from one that was never built. The zero case gets its own
   * words instead of "Show 0 transactions", because a bucket that fell to
   * nothing is exactly the one a reader wants explained.
   */
  // `nounPlural` also guards a caller passing a plural rowNoun ("accounts"),
  // so count-1 never renders "Show 1 accounts" (critic P2-C, latent today).
  const nounPlural = rowNoun.endsWith('s') ? rowNoun : `${rowNoun}s`;
  const visibleLabel = open
    ? 'Hide'
    : count === 0
      ? emptyToggleLabel
      : `Show ${count} ${count === 1 ? rowNoun : nounPlural}`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setEverOpened(true);
          const next = !open; // `open` is this render's value — correct for a click handler
          setOpen(next);
          onToggle?.(next);
        }}
        aria-expanded={open}
        aria-controls={panelId}
        // WCAG 2.5.3: the accessible name must CONTAIN the visible string, so the
        // subject is a prefix on it rather than a replacement for it.
        aria-label={`${name}: ${visibleLabel}`}
        data-testid={`${testIdPrefix}-toggle-${id}`}
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
        aria-label={`${nounPlural[0].toUpperCase()}${nounPlural.slice(1)} in ${name}`}
        data-testid={`${testIdPrefix}-panel-${id}`}
        className="mt-1.5 rounded-xl border bg-muted/40 p-2.5"
      >
        {!everOpened ? null : count === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid={`${testIdPrefix}-empty-${id}`}>
            {emptyCopy}
          </p>
        ) : (
          <ul className="divide-y" data-testid={`${testIdPrefix}-rows-${id}`}>
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
                  {!hideRowDates && (
                    <>
                      <span className="text-xs text-muted-foreground">{formatISODate(isoDate(r.date))}</span>{' '}
                    </>
                  )}
                  {r.transactionId ? (
                    <Link
                      /* C.15 (audit F3): a bare /transactions/<id> here dumped the
                         reader onto "Back to transactions" and out of the report
                         they were reading. The row now carries the hosting page's
                         return context (with its own query, e.g. the month). */
                      href={
                        returnToken
                          ? withForwardedReturn(
                              `/transactions/${encodeURIComponent(r.transactionId)}`,
                              namedPageBack(returnToken, pageQuery),
                            )
                          : `/transactions/${encodeURIComponent(r.transactionId)}`
                      }
                      className="rounded-sm underline decoration-dotted decoration-muted-foreground/70 underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {r.label}
                    </Link>
                  ) : (
                    r.label
                  )}
                  {r.isPending && <span className="ml-1.5 text-xs text-muted-foreground">(pending)</span>}
                  {/* U.16. The basis sentence below says N rows fall on a day a
                      combined account was changing connections; without this the
                      reader has to find them among every row in the bucket, and
                      the two lines it is about are IDENTICAL by construction —
                      same date, same payee, same amount. Marking the row is a
                      fact about its date, not a claim that it is the duplicate:
                      a handover day with only one connection reporting is marked
                      too, and the sentence is conditional for the same reason. */}
                  {r.onHandoverDay && (
                    <span
                      className="ml-1.5 text-xs text-muted-foreground"
                      data-testid={`${testIdPrefix}-handover-row`}
                    >
                      (connection changeover)
                    </span>
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
            <span className="tabular-nums" data-testid={`${testIdPrefix}-sum-${id}`}>
              {formatCents(subject.sumCents)}
            </span>
          </div>
        )}

        {/* The same fail-loud contract the Glass-Box panel carries: these rows
            were selected by the predicate that produced the figure, so a
            mismatch means something upstream is inconsistent and the reader is
            told, rather than shown a shorter list under a bigger number. */}
        {count > 0 &&
          (subject.reconciles ? (
            <p
              className="mt-1.5 text-xs font-normal text-muted-foreground"
              data-testid={`${testIdPrefix}-reconciled-${id}`}
            >
              {count === 1 ? (
                // C.11 critic cycle 2 (P2-2): the same one-row rule as the
                // Glass-Box panels — one amount beside the figure it is adds
                // nothing, so no penny-match prints on a single row.
                'This amount is the whole figure.'
              ) : (
                <>
                  These {count} rows add up to exactly{' '}
                  {formatCents(subject.headlineCents)} — matched to the penny.
                </>
              )}
            </p>
          ) : subject.clampedByNetRefund ? (
            /* Not a mismatch to apologise for — a documented clamp. Saying
               "we can't reconcile this" here would report a defect where the
               engines are doing exactly what they say, and would leave the
               reader with no idea why something with real rows reads $0.00. */
            <p
              className="mt-1.5 text-xs font-normal text-muted-foreground"
              data-testid={`${testIdPrefix}-net-refund-${id}`}
            >
              {netRefundCopy}
            </p>
          ) : (
            <p className="mt-1.5 text-xs font-normal" data-testid={`${testIdPrefix}-mismatch-${id}`}>
              These rows come to {formatCents(subject.sumCents)}, which is not the{' '}
              {formatCents(subject.headlineCents)} above. We can&apos;t reconcile that right now, and
              we&apos;d rather say so than hide it.
            </p>
          ))}

        {basis.map((b) => (
          <p key={b} className="mt-1 text-xs font-normal text-muted-foreground">
            {b}
          </p>
        ))}

        {registerHref && (
          <Link
            href={registerHref}
            data-testid={`${testIdPrefix}-register-${id}`}
            className="mt-2 inline-block text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {registerLabel}
          </Link>
        )}
      </div>
    </>
  );
}
