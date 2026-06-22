import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { getSpendingPlan } from '@/server/spending-plan';
import { formatCents } from '@/lib/money';
import { cents } from '@/lib/money';
import { prisma } from '@/lib/db';

export default async function SpendingPlanPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;

  if ((await prisma.account.count({ where: { userId } })) === 0) return <EmptyDashboard />;

  const p = await getSpendingPlan(userId);
  const positive = !p.overspent;

  // Bar segments (of expected income): spent / upcoming bills / savings / left.
  const total = Math.max(1, p.expectedIncomeCents);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
  const leftWidth = pct(Math.max(0, p.leftToSpendCents));

  const rows: { label: string; cents: number; tone: string; sign: '+' | '−' }[] = [
    { label: 'Expected income', cents: p.expectedIncomeCents, tone: 'text-emerald-500', sign: '+' },
    { label: 'Spent so far', cents: p.spentSoFarCents, tone: 'text-foreground', sign: '−' },
    { label: 'Bills still coming', cents: p.upcomingBillsCents, tone: 'text-foreground', sign: '−' },
    { label: 'Planned savings', cents: p.plannedSavingsCents, tone: 'text-foreground', sign: '−' },
  ];

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {/* Hero: the answer */}
      <section
        data-testid="spending-plan-hero"
        className="rounded-2xl border bg-gradient-to-br from-card to-accent/30 p-6 text-center shadow-sm"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Safe to spend this month
        </p>
        <p
          data-testid="safe-to-spend"
          className={`mt-1 text-5xl font-bold tabular-nums tracking-tight ${
            positive ? 'text-foreground' : 'text-red-500'
          }`}
        >
          {formatCents(cents(p.leftToSpendCents))}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {positive ? (
            <>
              ≈ <span className="font-semibold text-foreground">{formatCents(cents(p.perDayCents))}/day</span> for{' '}
              the {p.daysLeftInMonth} day{p.daysLeftInMonth === 1 ? '' : 's'} left
            </>
          ) : (
            <>You&apos;re {formatCents(cents(-p.leftToSpendCents))} over plan with {p.daysLeftInMonth} day
            {p.daysLeftInMonth === 1 ? '' : 's'} left — ease off.</>
          )}
        </p>

        {/* allocation bar */}
        <div className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="bg-rose-400/80" style={{ width: pct(p.spentSoFarCents) }} title="Spent" />
          <div className="bg-amber-400/80" style={{ width: pct(p.upcomingBillsCents) }} title="Upcoming bills" />
          <div className="bg-sky-400/80" style={{ width: pct(p.plannedSavingsCents) }} title="Savings" />
          <div className="bg-emerald-500/80" style={{ width: leftWidth }} title="Left to spend" />
        </div>
      </section>

      {/* Breakdown */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">How we got there</h2>
        <dl className="divide-y text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between py-2">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className={`tabular-nums ${r.tone}`}>
                {r.sign} {formatCents(cents(r.cents))}
              </dd>
            </div>
          ))}
          <div className="flex items-center justify-between py-2.5">
            <dt className="font-semibold">Left to spend</dt>
            <dd
              className={`text-base font-bold tabular-nums ${positive ? 'text-emerald-500' : 'text-red-500'}`}
            >
              {formatCents(cents(p.leftToSpendCents))}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Income left after what you&apos;ve already spent, the recurring bills still due this month, and your
          goal savings. Unlike a basic budget, it accounts for bills that haven&apos;t hit yet — so it won&apos;t
          tell you it&apos;s safe to spend money that&apos;s already promised.
        </p>
      </section>
    </div>
  );
}
