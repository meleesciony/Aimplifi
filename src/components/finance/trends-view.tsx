/**
 * Spending Trends view (DECISIONS #74). Surfaces what changed and what to look
 * at: an in-progress pace projection, completed-month category movers, the
 * biggest purchases, and new merchants. Every number comes from the pure
 * engine; this is a thin render. Copy follows the coaching guardrails
 * (educational, no shame, assumptions stated inline).
 */
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Gauge, Receipt, Sparkles, Store } from 'lucide-react';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents, formatCents, sumCents } from '@/lib/money';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import {
  CATEGORY_LINK_CLASS,
  CATEGORY_NAME_LINK_CLASS,
  MERCHANT_LINK_CLASS,
  categoryWindowRegisterHref,
  merchantRegisterHref,
} from '@/lib/engine/transactions/links';
import { wholeMonthWindow } from '@/lib/engine/reports/reports';
import {
  baselineLabel,
  newMerchantPanelBasis,
  paceAssumption,
  PACE_DELTA_SAME,
  PACE_NO_SPEND_YET,
  paceBillsPhrase,
  paceDeltaRelation,
  shortMonth,
} from '@/lib/engine/trends/labels';
import type { CategoryMover } from '@/lib/engine/trends/trends';
import { BreakdownPanel } from '@/components/finance/breakdown-panel';
import { CategoryBreakdownPanel } from '@/components/finance/category-breakdown-panel';
import { breakdownNetRefundCopy } from '@/lib/engine/glass-box/category-breakdown';
import type { CategoryBreakdown } from '@/lib/engine/glass-box/category-breakdown';
import type { BalanceMoveView } from '@/server/balance-move';
import { loanPaymentBasisSentence } from '@/server/loan-payment-basis';
import type { SpendingTrendsData } from '@/server/trends';

const money = (n: number, signed = false) =>
  formatCents(cents(n), signed ? { signDisplay: 'always' } : undefined);
const pct = (p: number) => `${p > 0 ? '+' : ''}${Math.round(p * 100)}%`;

/**
 * O.6 — which number on this row may carry the link.
 *
 * A mover prints THREE figures and only one of them is a set of rows the
 * register can show: `currentCents` is one calendar month (`comparedYm`) summed
 * by the same engine on the same basis, so it reconciles. `baselineCents` is an
 * AVERAGE over up to three months — no window exists that adds up to it — and
 * `deltaCents` is a difference between the two, which is not a sum of anything.
 * The delta is the biggest, boldest number on the row, which is exactly why the
 * link is nailed to the one figure that can honour it and the accessible name
 * says which month it opens.
 */
function MoverRow({
  m,
  href,
  monthLabel,
  isDial = false,
  breakdown,
}: {
  m: CategoryMover;
  href: string | null;
  /** The compared month, spelled out for the accessible name (e.g. "May"). */
  monthLabel: string;
  isDial?: boolean;
  /**
   * The rows behind `currentCents`. REQUIRED, not optional: an omitted breakdown
   * would render a row with no expander, which looks like the feature was never
   * built rather than like a gap — the same argument `ReportsView` makes about
   * `linkableCategoryIds`.
   */
  breakdown: CategoryBreakdown;
}) {
  const current = money(m.currentCents);
  // Audit P2: for a netted mover the $0.00 is a CLAMP (rows filed, refunds
  // netted them away), not a measured nothing — naming it here keeps the
  // accessible name in lockstep with the visible "net … after refunds" line
  // below, which is the collapsed-row version of the expander's
  // `clampedByNetRefund` sentence.
  const currentLabel = m.currentNetted ? `net ${current} after refunds` : current;
  const currentFigure =
    href === null ? (
      current
    ) : (
      <Link
        href={href}
        data-testid={`mover-category-link-${m.categoryId}`}
        // The month is load-bearing HERE and nowhere else: this is the one card
        // whose link opens a DIFFERENT month from the page's own headline, so a
        // screen-reader user who is not told "May" lands somewhere unannounced
        // (O.6 critic P1-5 — the previous label omitted it while the docblock
        // above claimed it was there).
        aria-label={`${m.name}: ${currentLabel} in ${monthLabel} — view these transactions`}
        className={CATEGORY_LINK_CLASS}
      >
        {current}
      </Link>
    );
  const tone =
    m.direction === 'down'
      ? 'text-positive-600 dark:text-positive-400'
      : m.direction === 'new'
        ? 'text-sky-600 dark:text-sky-400'
        : 'text-rose-600 dark:text-rose-400';
  const Icon = m.direction === 'down' ? ArrowDownRight : m.direction === 'new' ? Sparkles : ArrowUpRight;
  // Direction must not be conveyed by colour alone (WCAG 1.4.1) — label the icon.
  const directionLabel = m.direction === 'down' ? 'decrease' : m.direction === 'new' ? 'new' : 'increase';
  return (
    // `data-testid` rather than leaving the spec to count `li`: this row now
    // CONTAINS a list of its own (the breakdown panel), so "every mover row has a
    // link" cannot be expressed as a count of descendant list items any more.
    <li className="py-2" data-testid="mover-row">
      <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          {/* Owner-reported 2026-07-31. Same href and same refusal as the figure
              below; the name is simply the target a reader aims at. The weight
              stays here rather than in the shared class — see
              CATEGORY_NAME_LINK_CLASS. `min-w-0` keeps the truncation working now
              that the truncating element is an anchor (the iOS flexbox lesson). */}
          {href === null ? (
            <span className="truncate text-sm font-medium">{m.name}</span>
          ) : (
            <Link
              href={href}
              data-testid={`mover-category-name-link-${m.categoryId}`}
              aria-label={`${m.name}: ${currentLabel} in ${monthLabel} — view these transactions`}
              className={`min-w-0 truncate text-sm font-medium ${CATEGORY_NAME_LINK_CLASS}`}
            >
              {m.name}
            </Link>
          )}
          {isDial && <Gauge className="size-3.5 shrink-0 text-positive-600 dark:text-positive-400" aria-hidden />}
        </div>
        {/* Not `truncate`: this line now holds a LINK, and truncation clips from
            the end — the O.5 critic already found ~45px of an inbox link clipped
            out of a truncating span at 380px. A short line that wraps cannot
            overflow, so wrapping is the safe direction. */}
        <div className="text-xs text-muted-foreground">
          {m.direction === 'new' ? (
            <>new this period · {currentFigure}</>
          ) : m.currentNetted ? (
            // Audit P2: the $0.00 is a net-refund clamp, not a measured
            // nothing — the same clamp the expander explains via
            // `clampedByNetRefund`. Naming it here stops the collapsed row
            // claiming the reader spent nothing when the register holds
            // charges and refunds in that category.
            <>
              net {currentFigure} after refunds vs {money(m.baselineCents)} usual
            </>
          ) : (
            <>
              {currentFigure} vs {money(m.baselineCents)} usual
            </>
          )}
        </div>
        {isDial && (
          <div className="text-xs text-positive-600 dark:text-positive-400" data-testid="dial-tag">
            {COACH_COPY.dialTag(m.name)}
          </div>
        )}
      </div>
      <div className={`flex shrink-0 items-center gap-1 text-sm font-medium tabular-nums ${tone}`}>
        <Icon className="size-4" role="img" aria-label={directionLabel} />
        <span>
          {m.direction === 'new' ? 'New' : money(m.deltaCents, true)}
          {m.pctChange !== null && m.direction !== 'new' ? (
            <span className="ml-1 text-xs font-normal">({pct(m.pctChange)})</span>
          ) : null}
        </span>
      </div>
      </div>
      {/* The month this expands is `comparedYm`, the same one the figure's link
          opens — never the in-progress month the pace card above describes. The
          panel's own copy names no month; this card's heading already does. */}
      <CategoryBreakdownPanel
        breakdown={breakdown}
        categoryName={m.name}
        // `monthLabel` IS `comparedYm` spelled out — the same string this row's
        // accessible name already uses, so the panel cannot describe a different
        // month from the link beside it.
        windowLabel={monthLabel}
        registerHref={href}
        testIdPrefix="mover-breakdown"
      />
    </li>
  );
}

export function TrendsView({
  trends,
  dials = [],
  balanceMove = null,
  linkableCategoryIds = [],
}: {
  trends: SpendingTrendsData;
  dials?: string[];
  balanceMove?: BalanceMoveView | null;
  /** O.6: the register's own category option list — see getLinkableCategoryIds. */
  linkableCategoryIds?: string[];
}) {
  const {
    pace,
    movers,
    moverTotal,
    largest,
    newMerchants,
    newMerchantTotal,
    comparedYm,
    baselineMonths,
    breakdowns,
    asOfYm,
    asOfDate,
  } = trends;
  // C.3 gave the dashboard card the shared relation helper and left this surface
  // on a bare `> 0`, which put an exact tie in the "less" branch and tinted it
  // green — the same defect on the second surface fed by the same field. Both
  // now read one helper (fix the data class, not the reported surface).
  const paceDelta = pace ? paceDeltaRelation(pace.deltaVsPriorCents) : null;
  const paceBills = pace ? paceBillsPhrase(pace) : null;
  // money dials are category ids (O.17a); leftover stored names are resolved on the page
  const dialSet = new Set(dials);
  const linkable = new Set(linkableCategoryIds);
  // C.25 (#403, critic P1-4): a mover figure that dropped excluded loan
  // payments cannot link to a register that still counts them.
  const loanRefused = new Set(trends.loanPaymentRefusedCategories);
  // O.6: `comparedYm` is the month `currentCents` was summed over — the movers
  // block only renders when it is non-null, but the builder needs a string, so
  // the null case yields no links rather than a link to a guessed month.
  const moverHref = (m: CategoryMover) =>
    comparedYm === null
      ? null
      : categoryWindowRegisterHref(
          // C.26: whole month, and that is the right window here rather than an
          // oversight — a mover's `currentCents` comes from `categorySpendMap`,
          // which sums the calendar month, and `comparedYm` is normally a month
          // already complete. The window travels so the two cannot drift.
          {
            categoryId: m.categoryId,
            window: wholeMonthWindow(comparedYm),
            amountCents: m.currentCents,
          },
          linkable,
          loanRefused,
        );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Spending trends</h1>
        <Link href="/reports" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          See full reports →
        </Link>
      </div>

      {/* Pace — the in-progress month projected forward */}
      {pace ? (
        <section
          className="rounded-2xl border bg-card p-5 shadow-sm"
          data-testid="trends-pace"
          aria-label="Spending pace this month"
        >
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Gauge className="size-3.5" aria-hidden /> Pace · {shortMonth(pace.ym)}
          </h2>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{money(pace.projectedCents)}</span>
            <span className="text-sm text-muted-foreground">projected by month end</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {money(pace.spentSoFarCents)} spent in the first {pace.daysElapsed} day
            {pace.daysElapsed === 1 ? '' : 's'} ·{' '}
            {paceDelta!.relation === 'same' ? (
              <span data-testid="trends-pace-delta">{PACE_DELTA_SAME}</span>
            ) : (
              <>
                <span
                  data-testid="trends-pace-delta"
                  className={
                    paceDelta!.relation === 'more'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-positive-600 dark:text-positive-400'
                  }
                >
                  {money(paceDelta!.absCents)} {paceDelta!.relation}
                </span>{' '}
                than last month
              </>
            )}{' '}
            ({money(pace.priorMonthCents)})
          </p>
          {paceBills && (
            <p className="mt-1 text-sm text-muted-foreground" data-testid="trends-pace-bills">
              {paceBills}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {paceAssumption(pace)}
            {/* O.6: this figure MOVED (pending charges now count), so it states its
                basis for the same reason /budgets does — a reader comparing pages
                otherwise has no way to know which rows each one summed. */}{' '}
            <span data-testid="trends-pace-basis">Includes pending charges.</span>
          </p>
          {/* C.25 (#403): what THIS figure does not count — a loan payment
              carried elsewhere is counted on the committed side, so it leaves
              the pace projection in every month. The claim is scoped to the
              pace figure on purpose (O.18e-FU): the movers and biggest
              purchases drop the same rows, but the page's own "New this
              month" panel lists them — it follows the register, which shows
              the charge — so a sentence that claimed the payment vanished
              from the whole page would contradict the card below it. Speaks
              only when something moved; silence means nothing did. (When the
              pace ABSTAINS — the empty branch — but a payment did move, the
              figureless scope speaks there instead; O.18e-FU2.) */}
          {trends.loanPaymentExclusions.map((e, i) => (
            <p
              key={`${e.payee}:${e.loanName}:${e.paymentCents}:${i}`}
              className="mt-1 text-xs text-muted-foreground"
              data-testid="trends-loan-payment-basis"
            >
              {loanPaymentBasisSentence(e, 'pace-figure')}
            </p>
          ))}
        </section>
      ) : (
        // C.1: the engine abstains when nothing has been counted this month.
        // Dropping the card silently left the page with no answer at all on the
        // first days of a month; it keeps its heading and says why, in the same
        // words the dashboard card uses (the labels module's shared-wording rule).
        <section
          className="rounded-2xl border bg-card p-5 shadow-sm"
          data-testid="trends-pace-empty"
          aria-label="Spending pace this month"
        >
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Gauge className="size-3.5" aria-hidden /> Pace · {shortMonth(trends.asOfYm)}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">{PACE_NO_SPEND_YET}</p>
          {/* O.18e-FU2: the figureless state. PACE_NO_SPEND_YET is the
              surface's "silence means nothing did" — but a loan payment the
              pace drops is money that DID move, so an empty exclusion set is
              the only honest silence. The figureless scope says so without
              claiming a pace figure this branch does not render. */}
          {trends.loanPaymentExclusions.map((e, i) => (
            <p
              key={`${e.payee}:${e.loanName}:${e.paymentCents}:${i}`}
              className="mt-1 text-xs text-muted-foreground"
              data-testid="trends-loan-payment-basis-empty"
            >
              {loanPaymentBasisSentence(e, 'figureless')}
            </p>
          ))}
        </section>
      )}

      {/* Category movers — last completed month vs a 3-month baseline */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm" data-testid="trends-movers">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">What changed</h2>
          {comparedYm && (
            <span className="text-xs text-muted-foreground">
              {shortMonth(comparedYm)} vs {baselineLabel(baselineMonths)} average
            </span>
          )}
        </div>
        {/* O.19c: the header reads as complete, so when the MAX_MOVERS cap
            actually bound, say so — a 7th mover silently absent from a card
            titled as if exhaustive is the O.19 class. Abstains (renders
            nothing) when every qualifying change is listed. */}
        {moverTotal > movers.length && (
          <p className="mb-1 text-xs text-muted-foreground" data-testid="trends-movers-cap">
            Showing the top {movers.length} of {moverTotal} changed categories, by size of change.
          </p>
        )}
        {/* O.6 / L.29: these figures moved too, and unlike Pace they are also the
            ones carrying links — so the basis a reader would need in order to
            check them against the register belongs beside them. */}
        <p className="mb-2 text-xs text-muted-foreground" data-testid="trends-movers-basis">
          {/* The sentence ENUMERATES what a reader can do, which makes it a claim
              that goes stale when an affordance is added beside it (the
              enumerated-actions corollary in new-egress-means-auditing-every-live-
              claim). Expanding a row now lists the same transactions in place;
              the figure still opens them in the register. */}
          Totals include pending charges. Expand a row to see the transactions behind it, or tap the
          month&rsquo;s figure to open them in your activity list.
        </p>
        {balanceMove?.sentence && (
          <p className="mb-2 text-sm text-muted-foreground" data-testid="balance-move-explainer">
            {balanceMove.sentence}
            {balanceMove.interpreted && (
              <span
                className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium text-muted-foreground"
                title="Worded by AI from your own figures — every amount is computed by Aimplifi, never by the model."
                data-testid="balance-move-interpreted"
              >
                <Sparkles className="size-2.5" aria-hidden /> AI-worded
              </span>
            )}
          </p>
        )}
        {movers.length === 0 ? (
          <p className="py-5 text-center text-sm text-muted-foreground">
            {comparedYm
              ? 'No notable category changes — your spending held steady.'
              : 'Not enough history yet to compare months.'}
          </p>
        ) : (
          <ul className="divide-y">
            {movers.map((m) => (
              <MoverRow
                key={m.categoryId}
                m={m}
                href={moverHref(m)}
                monthLabel={comparedYm ? shortMonth(comparedYm) : 'that month'}
                isDial={dialSet.has(m.categoryId)}
                breakdown={breakdowns[m.categoryId]}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Largest purchases this month */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm" data-testid="trends-largest">
        <div className="mb-1 flex items-center gap-2">
          <Receipt className="size-3.5 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold">Biggest purchases this month</h2>
        </div>
        {/* O.6 (L.29 — put the basis in the label): this page deliberately answers
            two different questions on two bases, and only the reader can tell they
            disagree, so the one that differs says so. The earlier wording said a
            pending charge "counts toward the totals above", which was imprecise in
            a way a critic caught: a THIS-month pending charge counts toward Pace,
            but the movers describe the previous month, so it cannot count there. */}
        <p className="mb-2 text-xs text-muted-foreground" data-testid="trends-largest-basis">
          Settled purchases only — a pending charge can still change amount, so it counts
          toward the Pace total above but is not named here until it posts.
        </p>
        {largest.length === 0 ? (
          <p className="py-5 text-center text-sm text-muted-foreground">No purchases yet this month.</p>
        ) : (
          <ul className="divide-y">
            {largest.map((l, i) => (
              <li key={`${l.date}-${l.merchant}-${i}`} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  {/* O.15 slice 1 — "Largest purchases" is a list of single charges
                      the reader is being invited to examine; the name has to open them. */}
                  <Link
                    href={merchantRegisterHref(l.merchant)}
                    data-testid="trends-largest-merchant-link"
                    className={`block truncate text-sm ${MERCHANT_LINK_CLASS}`}
                  >
                    {l.merchant}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground">
                    {l.categoryName} · {formatISODate(isoDate(l.date), 'short')}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">{money(l.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* New merchants */}
      {newMerchants.length > 0 && (
        <section className="rounded-2xl border bg-card p-5 shadow-sm" data-testid="trends-new-merchants">
          <div className="mb-1 flex items-center gap-2">
            <Store className="size-3.5 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold">New this month</h2>
          </div>
          {/* Two claims, two bases, both stated (O.8a / L.29). "You shopped
              somewhere new" is a claim about an EVENT, so a merchant earns its
              place here only on a settled purchase — a pending authorisation has
              not finished being one. The AMOUNT is an aggregate at merchant
              scope, so it counts pending charges and nets refunds.

              Three earlier drafts of this sentence were each falsified by a
              critic, and the corrections are why it reads as it does:
               - "appears here once a purchase settles" promised something the
                 net-≤-0 drop breaks — a settled purchase fully refunded does NOT
                 appear — so the drop is now stated rather than implied;
               - "the same way your reports and budgets do" over-claimed: this
                 amount applies a `<= today` guard and /reports does not, so a
                 future-dated manual row is counted there and not here;
               - naming Ask as the surface it agrees with would be false for
                 prefix-family merchants (see TASKS O.10), so no surface is named.
              Every clause here is about THIS card and nothing else. */}
          {/* O.19c: same rule as the movers cap above — state the truncation
              only when it happened, its own sentence (one claim per sentence,
              not folded into the basis paragraph below). */}
          {newMerchantTotal > newMerchants.length && (
            <p className="mb-1 text-xs text-muted-foreground" data-testid="trends-new-merchants-cap">
              Showing the top {newMerchants.length} of {newMerchantTotal} new merchants, by amount
              spent.
            </p>
          )}
          <p className="mb-2 text-xs text-muted-foreground" data-testid="trends-new-merchants-basis">
            A merchant is confirmed here by a settled purchase. The amount counts charges still
            pending and nets refunds against them, so a merchant whose refunds cancelled the month
            drops off this list.
          </p>
          <ul className="divide-y">
            {newMerchants.map((n) => {
              // O.18e — the figure above is this merchant's month. The rows come
              // out of the SAME pass that summed the figure (carry-out, #439), so
              // the panel's rows and the card's number cannot disagree by
              // construction; `reconciles` stays the fail-loud contract anyway.
              const sum = sumCents(n.rows.map((r) => r.amountCents));
              return (
                <li key={n.merchant} className="py-2" data-testid="new-merchant-row">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      {/* O.15 slice 1 — the card whose whole subject is a merchant the
                          reader has never seen before. "What is this?" is the only question
                          anyone has here, and until now the card could not answer it. */}
                      <Link
                        href={merchantRegisterHref(n.merchant)}
                        data-testid="trends-new-merchant-link"
                        className={`block truncate text-sm ${MERCHANT_LINK_CLASS}`}
                      >
                        {n.merchant}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">{n.categoryName}</div>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums">{money(n.amountCents)}</span>
                  </div>
                  {/* O.18e — "what is this, exactly?" gets its answer. The basis
                      names the window this figure actually sums: the in-progress
                      month THROUGH the as-of date, while the movers below compare
                      complete months — a bare "$80.00" beside them would read as
                      the whole month (C.26's stop-at-today lesson). The card's
                      own merchant link is the register door, so the panel borrows
                      it rather than inventing a merchant+window link variant
                      (scope discipline; the row's link already exists) — and the
                      label says what that link opens: the merchant's whole
                      activity, a superset of these rows, never "these". */}
                  <BreakdownPanel
                    subject={{
                      id: n.merchant,
                      name: n.merchant,
                      headlineCents: cents(n.amountCents),
                      rows: n.rows,
                      sumCents: sum,
                      reconciles: sum === cents(n.amountCents),
                      clampedByNetRefund: false,
                    }}
                    emptyCopy="No transactions behind this figure."
                    // Never printed for a listed merchant (net-≤-0 rows are
                    // dropped before they reach the card) — required, truthful.
                    netRefundCopy={breakdownNetRefundCopy(formatCents(sum), shortMonth(asOfYm))}
                    basis={newMerchantPanelBasis({
                      figure: money(n.amountCents),
                      monthLabel: shortMonth(asOfYm),
                      throughLabel: formatISODate(isoDate(asOfDate), 'long'),
                      futureDatedCents: n.futureDatedCents,
                      countedOnHandoverDays: n.countedOnHandoverDays,
                      // The SAME check the panel's penny-match line prints,
                      // read off the same `sum` two lines above — so the
                      // sentence's "these still add up" clause cannot claim a
                      // tally the panel is simultaneously reporting as broken.
                      // The panel prints a tally only when it lists more than one row;
                      // at exactly one it says "This amount is the whole figure." instead.
                      statesATally: sum === cents(n.amountCents) && n.rows.length > 1,
                    })}
                    registerHref={merchantRegisterHref(n.merchant)}
                    // The default label ("Open these...") would promise exactly
                    // this panel's rows; the merchant register shows the
                    // merchant's whole history — a superset — so the label names
                    // what it actually opens (O.18c made the same choice).
                    registerLabel={`Open ${n.merchant} in your activity list, where you can re-file one →`}
                    testIdPrefix="new-merchant-breakdown"
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
