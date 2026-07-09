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

  // Bar segments (of expected income): spent / upcoming bills / savings / left.
  const total = Math.max(1, p.expectedIncomeCents);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
  const leftWidth = pct(Math.max(0, p.leftToSpendCents));

  // Glass-Box (DECISIONS #178): the breakdown rows come from the tested trace
  // engine — the same signed rows whose plain sum IS the headline — so the
  // reconciliation line below is a real, engine-checked claim, not decoration.
  const trace = traceSafeToSpend(p);
  const rows = trace.rows.map((r) => ({
    label: r.label,
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
        {/* Overspent reframe (ROADMAP COPY-1): a giant "-$89.29" under a "safe to
            spend" label reads like a broken number. Say what it means instead:
            you're over plan by a positive amount, and safe-to-spend is $0. */}
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {positive ? 'Safe to spend this month' : 'Over plan this month'}
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
              ≈ <span className="font-semibold text-foreground">{formatCents(cents(p.perDayCents))}/day</span> for{' '}
              the {p.daysLeftInMonth} day{p.daysLeftInMonth === 1 ? '' : 's'} left
            </>
          ) : (
            <>Safe to spend is $0 for the {p.daysLeftInMonth} day{p.daysLeftInMonth === 1 ? '' : 's'} left —
            one tight month is weather, not climate.</>
          )}
        </p>

        {/* allocation bar + visible legend (ROADMAP ALSO CONSIDER / #186) —
            title= tooltips alone are invisible on touch; label the four segments. */}
        <div
          className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label="Allocation of expected income: spent, upcoming bills, savings, left to spend"
        >
          <div className="bg-rose-400/80" style={{ width: pct(p.spentSoFarCents) }} title="Spent" />
          <div className="bg-amber-400/80" style={{ width: pct(p.upcomingBillsCents) }} title="Upcoming bills" />
          <div className="bg-sky-400/80" style={{ width: pct(p.plannedSavingsCents) }} title="Savings" />
          <div className="bg-emerald-500/80" style={{ width: leftWidth }} title="Left to spend" />
        </div>
        <ul
          data-testid="spending-plan-legend"
          className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          {(
            [
              { swatch: 'bg-rose-400/80', label: 'Spent' },
              { swatch: 'bg-amber-400/80', label: 'Upcoming bills' },
              { swatch: 'bg-sky-400/80', label: 'Savings' },
              { swatch: 'bg-emerald-500/80', label: 'Left to spend' },
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
            <dt className="font-semibold">Left to spend</dt>
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
            These four lines add up to exactly the &ldquo;Left to spend&rdquo; amount — matched to
            the penny from your own transactions, recurring bills, and goals. Nothing here is
            invented.
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
          Income left after what you&apos;ve already spent, the recurring bills still due this month, and your
          goal savings. Unlike a basic budget, it accounts for bills that haven&apos;t hit yet — so it won&apos;t
          tell you it&apos;s safe to spend money that&apos;s already promised.
        </p>
      </section>
    </div>
  );
}
