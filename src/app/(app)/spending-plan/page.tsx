import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { getSpendingPlan } from '@/server/spending-plan';
import { traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import type { CardNote } from '@/lib/engine/spending-plan/row-labels';
import { planCardNoteParts } from '@/lib/engine/spending-plan/row-labels';
import { formatCents } from '@/lib/money';
import { cents } from '@/lib/money';
import { prisma } from '@/lib/db';

/**
 * One testid per disclosed fact, unchanged from when these four notes were written
 * out by hand here. `excluded` is the COMPACT surfaces' merged undated+pending
 * sentence, which this page never renders (it splits them); it is mapped anyway so
 * the record is total and a future `detail` change cannot produce an undefined
 * testid silently.
 */
const PLAN_NOTE_TESTID: Record<CardNote['fact'], string> = {
  excluded: 'plan-undated-note',
  undated: 'plan-undated-note',
  'statement-pending': 'plan-statement-pending-note',
  duplicate: 'plan-duplicate-note',
  frozen: 'plan-frozen-note',
};

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
  const trace = traceSafeToSpend(p, d);
  const rows = trace.rows.map((r) => ({
    label: r.isEstimated ? `${r.label} (estimated)` : r.label,
    // L.29: only a $0 row meaning "you have not set this up" carries one, and the
    // engine decides which those are — so this page and the Ask answer agree.
    action: r.action,
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
            <div key={r.label} className="flex items-center justify-between gap-3 py-2" data-testid="plan-row">
              <dt className="min-w-0 text-muted-foreground" data-testid="plan-row-label">
                {r.label}
                {/* The control for a zero that means "you have not set this up"
                    (L.29). Deliberately in the LABEL cell: `plan-row-amount` is
                    parsed as money by the reconciliation e2e, so nothing but a
                    figure may enter it. */}
                {r.action ? (
                  <>
                    {' '}
                    <Link
                      href={r.action.href}
                      className="whitespace-nowrap underline underline-offset-2 hover:text-foreground"
                      data-testid="plan-row-action"
                    >
                      {r.action.label}
                    </Link>
                  </>
                ) : null}
              </dt>
              <dd className={`shrink-0 tabular-nums ${r.tone}`} data-testid="plan-row-amount">
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
        {/* L.29 critic P2-4: this paragraph reprinted, unconditionally, the two
            claims the trace had just gated — so a reader with no card still read
            "each card is assumed paid in full" one paragraph below a line saying no
            card is linked, and a reader who HAS set a savings target (or who is
            being offered the link two inches above) was still told to go set one.
            A gate on a shared sentence is worth nothing while a second copy of the
            sentence is unconditional. */}
        <p className="mt-3 text-xs text-muted-foreground">
          Your monthly income pattern minus fixed and recurring expenses, the card payments due
          this month, anything already dated just past it, and your savings — in the{' '}
          <em>I Will Teach You to Be Rich</em> sense: once those are covered, what&apos;s left is
          yours to spend without guilt. Income is a trailing pattern, not what has posted so far;
          discretionary spending is never subtracted.
          {d.creditCardCount > 0 ? (
            <>
              {' '}
              Card purchases count when their statement&apos;s payment comes due, not again at
              purchase time, and each card is assumed paid in full.
            </>
          ) : null}
          {p.savingsTargetBps == null && p.plannedSavingsCents > 0 ? (
            <> Set a savings target in Settings to reserve a share of income first.</>
          ) : null}
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
            We recognize six rhythms: weekly, every two weeks, monthly, quarterly, twice a year
            and yearly. A bill that repeats on any rhythm between or beyond them — every ten
            days, every three weeks, every six weeks, every couple of months, every four or five
            months, or every year and a half — is not counted as a recurring bill at all, so{' '}
            {positive
              ? 'the real amount free to spend may be lower than shown'
              : 'the real overage may be higher than shown'}
            .
          </li>
          <li data-testid="plan-long-cadence-precondition-note">
            A bill on one of the longer rhythms has to have been charged three times at a steady
            price before the pattern is visible — roughly six months of history for a quarterly
            bill, a year for a twice-a-year one, two years for a yearly one — and one whose price
            rises every time never becomes visible. A quarterly or twice-a-year bill also has to
            have kept a steady rhythm every time we can see, not just the first three: if the gaps
            between its charges differ by more than about a week, we leave the whole series out
            rather than guess at a rhythm, and later on-time charges don&apos;t bring it back.
            Anything we can&apos;t see counts as $0 here, so{' '}
            {positive
              ? 'the real amount free to spend may be lower than shown'
              : 'the real overage may be higher than shown'}
            .
          </li>
          <li data-testid="plan-long-cadence-overdue-note">
            And a long-rhythm bill we were counting stops counting once it is more than half a
            cycle overdue — about four and a half months for a quarterly bill, nine for a
            twice-a-year one, eighteen for a yearly one. That is how we tell a cancelled policy
            from a late one, but a bill that is merely running late drops out of this figure
            until it charges again, so{' '}
            {positive
              ? 'the real amount free to spend may be lower than shown'
              : 'the real overage may be higher than shown'}
            .
          </li>
          {/* O.18f: these four notes were hand-rolled here and had drifted from the
              three other authors of the same facts. `planCardNoteParts` is now the
              class's only author; the testid per fact is preserved, and the sentences
              are selected by TAG so an abstaining fact cannot shift the others. */}
          {planCardNoteParts(d, {
            // This section sits under a figure that flips to an overage when negative.
            headline: positive ? 'left-to-spend' : 'overage',
            container: 'the card-payments line',
            // The full "What this figure can't see" list — room to name every card.
            detail: 'named',
            // The page states the fixed-expenses line separately, above.
            fixedCostsName: null,
          }).map((n, i) => (
            <li key={`${n.fact}-${i}`} data-testid={PLAN_NOTE_TESTID[n.fact]}>
              {n.text}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
