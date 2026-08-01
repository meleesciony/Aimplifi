/**
 * Spending Trends view (DECISIONS #74). Surfaces what changed and what to look
 * at: an in-progress pace projection, completed-month category movers, the
 * biggest purchases, and new merchants. Every number comes from the pure
 * engine; this is a thin render. Copy follows the coaching guardrails
 * (educational, no shame, assumptions stated inline).
 */
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Gauge, Receipt, Sparkles, Store } from 'lucide-react';
import { formatISODate, formatMonth, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import {
  CATEGORY_LINK_CLASS,
  CATEGORY_NAME_LINK_CLASS,
  MERCHANT_LINK_CLASS,
  categoryMonthRegisterHref,
  merchantRegisterHref,
} from '@/lib/engine/transactions/links';
import type { CategoryMover } from '@/lib/engine/trends/trends';
import { CategoryBreakdownPanel } from '@/components/finance/category-breakdown-panel';
import type { CategoryBreakdown } from '@/lib/engine/glass-box/category-breakdown';
import type { BalanceMoveView } from '@/server/balance-move';
import type { SpendingTrendsData } from '@/server/trends';

const money = (n: number, signed = false) =>
  formatCents(cents(n), signed ? { signDisplay: 'always' } : undefined);
const pct = (p: number) => `${p > 0 ? '+' : ''}${Math.round(p * 100)}%`;
const shortMonth = (ym: string) => formatMonth(ym, 'short');

function baselineLabel(months: string[]): string {
  if (months.length === 0) return 'earlier months';
  if (months.length === 1) return shortMonth(months[0]);
  // months are most-recent-first; read them oldest→newest for the range label
  const oldest = shortMonth(months[months.length - 1]);
  const newest = shortMonth(months[0]);
  return `${oldest}–${newest}`;
}

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
        aria-label={`${m.name}: ${current} in ${monthLabel} — view these transactions`}
        className={CATEGORY_LINK_CLASS}
      >
        {current}
      </Link>
    );
  const tone =
    m.direction === 'down'
      ? 'text-emerald-600 dark:text-emerald-400'
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
              aria-label={`${m.name}: ${current} in ${monthLabel} — view these transactions`}
              className={`min-w-0 truncate text-sm font-medium ${CATEGORY_NAME_LINK_CLASS}`}
            >
              {m.name}
            </Link>
          )}
          {isDial && <Gauge className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />}
        </div>
        {/* Not `truncate`: this line now holds a LINK, and truncation clips from
            the end — the O.5 critic already found ~45px of an inbox link clipped
            out of a truncating span at 380px. A short line that wraps cannot
            overflow, so wrapping is the safe direction. */}
        <div className="text-xs text-muted-foreground">
          {m.direction === 'new' ? (
            <>new this period · {currentFigure}</>
          ) : (
            <>
              {currentFigure} vs {money(m.baselineCents)} usual
            </>
          )}
        </div>
        {isDial && (
          <div className="text-xs text-emerald-600 dark:text-emerald-400" data-testid="dial-tag">
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
  const { pace, movers, moverTotal, largest, newMerchants, newMerchantTotal, comparedYm, baselineMonths, breakdowns } =
    trends;
  const paceUp = pace ? pace.deltaVsPriorCents > 0 : false;
  // money dials are user-configured category labels; tag a mover when its category is one
  const dialSet = new Set(dials.map((d) => d.toLowerCase()));
  const linkable = new Set(linkableCategoryIds);
  // O.6: `comparedYm` is the month `currentCents` was summed over — the movers
  // block only renders when it is non-null, but the builder needs a string, so
  // the null case yields no links rather than a link to a guessed month.
  const moverHref = (m: CategoryMover) =>
    comparedYm === null
      ? null
      : categoryMonthRegisterHref({ categoryId: m.categoryId, month: comparedYm, amountCents: m.currentCents }, linkable);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Spending trends</h1>
        <Link href="/reports" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          See full reports →
        </Link>
      </div>

      {/* Pace — the in-progress month projected forward */}
      {pace && (
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
            <span className={paceUp ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
              {money(Math.abs(pace.deltaVsPriorCents))} {paceUp ? 'more' : 'less'}
            </span>{' '}
            than last month ({money(pace.priorMonthCents)})
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Assumes spending continues at the current daily rate — a projection, not a prediction.
            {/* O.6: this figure MOVED (pending charges now count), so it states its
                basis for the same reason /budgets does — a reader comparing pages
                otherwise has no way to know which rows each one summed. */}{' '}
            <span data-testid="trends-pace-basis">Includes pending charges.</span>
          </p>
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
                isDial={dialSet.has(m.name.toLowerCase())}
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
            {newMerchants.map((n) => (
              <li key={n.merchant} className="flex items-center justify-between gap-3 py-2">
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
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
