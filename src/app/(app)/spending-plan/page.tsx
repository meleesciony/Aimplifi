import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { getSpendingPlan } from '@/server/spending-plan';
import { traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import { formatCents } from '@/lib/money';
import { cents } from '@/lib/money';
import { prisma } from '@/lib/db';

export const metadata = { title: "Spending plan" };

export default async function SpendingPlanPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;

  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  const p = await getSpendingPlan(userId);
  const positive = !p.overspent;
  // The dashboard card's empty state, mirrored: with no pattern and no obligations there is
  // no figure, so the page must not print "$0.00" beside "matched to the penny" (cycle-2 P2-4).
  const noData =
    p.patternIncomeCents === 0 &&
    p.fixedExpensesCents === 0 &&
    p.cardObligationsCents === 0 &&
    p.obligationsBeyondMonthCents === 0 &&
    p.plannedSavingsCents === 0;
  if (noData) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="sr-only">Spending plan</h1>
        <section
          data-testid="spending-plan-hero"
          className="rounded-2xl border bg-gradient-to-br from-card to-accent/30 p-6 text-center shadow-sm"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Guilt-free to spend
          </p>
          <p className="mt-2 text-sm text-muted-foreground" data-testid="spending-plan-empty">
            Once we can see your income — a complete month posted, or a recurring paycheck
            detected — your guilt-free spending amount shows up here, with every line of the
            arithmetic behind it.
          </p>
        </section>
      </div>
    );
  }

  // Bar segments (of pattern income): fixed / card payments / savings / left.
  const total = Math.max(1, p.patternIncomeCents);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
  const leftWidth = pct(Math.max(0, p.leftToSpendCents));
  const d = p.disclosures;

  // Glass-Box (DECISIONS #178): the breakdown rows come from the tested trace
  // engine — the same signed rows whose plain sum IS the headline — so the
  // reconciliation line below is a real, engine-checked claim, not decoration.
  const trace = traceSafeToSpend(p);
  const rows = trace.rows.map((r) => ({
    label: r.isEstimated ? `${r.label} (estimated)` : r.label,
    cents: Math.abs(r.amountCents),
    tone: r.id === 'income' ? 'text-emerald-500' : 'text-foreground',
    // Sign from the VALUE (so the rendered lines can never contradict the
    // reconciled sum), with the row's role deciding only the $0 case — a $0
    // deduction keeps its '−' meaning instead of flipping to "+ $0.00".
    sign:
      r.amountCents > 0
        ? ('+' as const)
        : r.amountCents < 0
          ? ('−' as const)
          : r.id === 'income'
            ? ('+' as const)
            : ('−' as const),
  }));

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="sr-only">Spending plan</h1>
      {/* Hero: the answer */}
      <section
        data-testid="spending-plan-hero"
        className="rounded-2xl border bg-gradient-to-br from-card to-accent/30 p-6 text-center shadow-sm"
      >
        {/* Overspent reframe (ROADMAP COPY-1): a giant "-$89.29" under a
            guilt-free label reads like a broken number. Say what it means
            instead: you're over plan by a positive amount, and guilt-free is $0. */}
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {positive ? 'Guilt-free to spend this month' : 'Over plan this month'}
        </p>
        <p
          data-testid="safe-to-spend"
          className={`mt-1 text-5xl font-bold tabular-nums tracking-tight ${
            positive ? 'text-foreground' : 'text-red-500'
          }`}
        >
          {formatCents(cents(positive ? p.leftToSpendCents : -p.leftToSpendCents))}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {positive ? (
            <>
              your monthly allocation after fixed costs, card payments, and savings — the{' '}
              <em>I Will Teach You to Be Rich</em> guilt-free figure
            </>
          ) : (
            <>Your income pattern is more than spoken for by fixed costs, card payments, and
            savings — the plan below shows which line drives it.</>
          )}
        </p>
        {/* L.11(D). The reader is looking at a number far below what the five
            monthly lines reach, and the reason is a payment dated outside this
            month's window — which no line above can show. Says what was held
            and why, on the surface that prints the figure. */}
        {p.reservesBeyondMonth ? (
          <p className="mt-2 text-xs text-amber-500" data-testid="plan-held-note">
            {formatCents(cents(p.obligationsBeyondMonthCents))} of your income is set aside for
            card payments dated after this month, through {p.obligationsBeyondMonthThroughDate} —
            only the part your scheduled income does not arrive in time to cover. Without it a
            statement due just past this month would sit in no plan you can see.
          </p>
        ) : null}

        {/* allocation bar + visible legend (ROADMAP ALSO CONSIDER / #186) —
            title= tooltips alone are invisible on touch; label the segments. */}
        <div
          className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`Allocation of monthly income: fixed expenses, card payments, savings, ${p.reservesBeyondMonth ? 'card payments due after this month, ' : ''}guilt-free`}
        >
          <div className="bg-amber-400/80" style={{ width: pct(p.fixedExpensesCents) }} title="Fixed expenses" />
          <div className="bg-violet-400/80" style={{ width: pct(p.cardObligationsCents) }} title="Card payments" />
          <div className="bg-sky-400/80" style={{ width: pct(p.plannedSavingsCents) }} title="Savings" />
          {/* L.11(D): its own segment, or the bar would stop being an
              allocation of the whole income and the legend would not explain
              the gap. */}
          <div
            className="bg-slate-400/80"
            style={{ width: pct(p.obligationsBeyondMonthCents) }}
            title="Card payments due after this month"
          />
          <div className="bg-emerald-500/80" style={{ width: leftWidth }} title="Guilt-free" />
        </div>
        <ul
          data-testid="spending-plan-legend"
          className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          {(
            [
              { swatch: 'bg-amber-400/80', label: 'Fixed expenses' },
              { swatch: 'bg-violet-400/80', label: 'Card payments' },
              { swatch: 'bg-sky-400/80', label: 'Savings' },
              ...(p.reservesBeyondMonth
                ? ([{ swatch: 'bg-slate-400/80', label: 'Cards due after this month' }] as const)
                : []),
              { swatch: 'bg-emerald-500/80', label: 'Guilt-free' },
            ] as const
          ).map((item) => (
            <li key={item.label} className="inline-flex items-center gap-1.5">
              <span className={`size-2 shrink-0 rounded-full ${item.swatch}`} aria-hidden />
              {item.label}
            </li>
          ))}
        </ul>
      </section>

      {/* Breakdown */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">How we got there</h2>
        <dl className="divide-y text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between py-2">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className={`tabular-nums ${r.tone}`} data-testid="plan-row-amount">
                {r.sign} {formatCents(cents(r.cents))}
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between py-2.5">
            <dt className="font-semibold">Guilt-free to spend</dt>
            <dd
              data-testid="plan-total"
              className={`text-base font-bold tabular-nums ${positive ? 'text-emerald-500' : 'text-red-500'}`}
            >
              {formatCents(cents(trace.sumCents))}
            </dd>
          </div>
        </dl>
        {trace.reconciles ? (
          <p className="mt-3 text-xs text-muted-foreground" data-testid="plan-reconciled">
            {/* The space before "lines" is explicit: an interpolation followed by a plain
                space renders as "6lines" here, which the e2e caught and no unit test could. */}
            These {rows.length}{' '}
            lines add up to exactly the &ldquo;Guilt-free to spend&rdquo;
            amount — matched to the penny from your own data. A line marked
            &ldquo;estimated&rdquo; says so; every other line comes straight from your
            transactions, detected bills, card obligations, and savings plan.
          </p>
        ) : (
          <p className="mt-3 text-xs" data-testid="plan-mismatch">
            These lines don&apos;t add up to the headline exactly — we can&apos;t fully reconcile it
            right now, and we&apos;d rather say so than pretend.
          </p>
        )}
        {trace.basis.map((b) => (
          <p key={b} className="mt-1.5 text-xs text-muted-foreground">
            {b}
          </p>
        ))}
        <p className="mt-3 text-xs text-muted-foreground">
          Your monthly income pattern minus fixed and recurring expenses, the card payments due
          this month, anything already dated just past it, and your savings — in the{' '}
          <em>I Will Teach You to Be Rich</em> sense: once those are covered, what&apos;s left is
          yours to spend without guilt. Income is a trailing pattern, not what has posted so far;
          discretionary spending is never subtracted. Card purchases count when their
          statement&apos;s payment comes due, not again at purchase time, and each card is assumed
          paid in full. Set a savings target in Settings to reserve a share of income first.
        </p>
      </section>

      {/* What this figure cannot see — each claim states its own direction, for the
          quantity itself (anchor-free — the hero shows the overage when overspent),
          and no figure above was adjusted (#192/#299 stance).

          Unconditional since L.23: the first two items below are properties of the
          DETECTOR rather than of any one card, so they hold for every reader — and
          both point the same way (a bill nobody counted makes the figure too
          generous). The per-card items keep their own gates. */}
      <section
        className="rounded-2xl border bg-card p-5 shadow-sm"
        data-testid="spending-plan-disclosures"
      >
        <h2 className="mb-2 text-sm font-semibold">What this figure can&apos;t see</h2>
        <ul className="space-y-2 text-xs text-muted-foreground">
          <li data-testid="plan-unrecognized-cadence-note">
            A bill that repeats on a rhythm we don&apos;t recognize yet — every ten days, every
            three weeks, every six weeks, every couple of months, quarterly, or twice a year — is
            not counted as a recurring bill at all, so{' '}
            {positive
              ? 'the real amount free to spend may be lower than shown'
              : 'the real overage may be higher than shown'}
            . We recognize weekly, every-two-weeks, monthly and yearly rhythms.
          </li>
          {!p.scheduledFixed.some((s) => s.cadence === 'ANNUAL') && (
            <li data-testid="plan-annual-precondition-note">
              A yearly bill has to have been charged three times at a steady price before the
              pattern is visible — roughly two years of history — and a premium that rises every
              year never becomes visible. Until then a yearly bill counts as $0 here, so{' '}
              {positive
                ? 'the real amount free to spend may be lower than shown'
                : 'the real overage may be higher than shown'}
              .
            </li>
          )}
          {d.undatedCards.length > 0 && (
            <li data-testid="plan-undated-note">
              {d.undatedCards.length === 1 ? 'One card has' : `${d.undatedCards.length} cards have`} a
              balance but no due date yet ({d.undatedCards.map((c) => c.cardName).join(', ')}) —{' '}
              {d.undatedCards.length === 1 ? 'its payment is' : 'their payments are'} not in the
              card-payments line, so{' '}
              {positive
                ? 'the real amount free to spend may be lower than shown'
                : 'the real overage may be higher than shown'}
              .
            </li>
          )}
          {d.statementPendingCards.length > 0 && (
            <li data-testid="plan-statement-pending-note">
              {d.statementPendingCards.length === 1 ? 'A statement has' : 'Statements have'} not
              been generated yet for{' '}
              {d.statementPendingCards.map((c) => `${c.cardName} (due around ${c.dueDate})`).join('; ')}, so{' '}
              {d.statementPendingCards.length === 1 ? 'that payment is' : 'those payments are'} not in
              the card-payments line —{' '}
              {positive
                ? 'the real amount free to spend may be lower than shown'
                : 'the real overage may be higher than shown'}
              .
            </li>
          )}
          {d.duplicatePairs.map((pair, i) => (
            <li key={i} data-testid="plan-duplicate-note">
              {pair.aName} and {pair.bName} in the card-payments line look like the same card
              counted twice ({pair.confidence === 'high' ? 'strong match' : 'possible match'}).
              If so, that line is higher than you owe and{' '}
              {positive
                ? 'the real amount free to spend is higher than shown'
                : 'the real overage is smaller than shown'}
              . No amount was adjusted — only you can confirm it, on Accounts.
            </li>
          ))}
          {d.frozenCards.length > 0 && (
            <li data-testid="plan-frozen-note">
              The bank stopped sharing{' '}
              {d.frozenCards.length === 1
                ? `one card in the card-payments line (${d.frozenCards[0].label}, since ${d.frozenCards[0].frozenSince})`
                : `${d.frozenCards.length} cards in the card-payments line (${d.frozenCards.map((c) => c.label).join(', ')})`}
              , so {d.frozenCards.length === 1 ? 'its amount' : 'their amounts'} may be stale.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
