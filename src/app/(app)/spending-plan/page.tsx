import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { getSpendingPlan } from '@/server/spending-plan';
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

  const rows: { label: string; cents: number; tone: string; sign: '+' | '−' }[] = [
    { label: 'Expected income', cents: p.expectedIncomeCents, tone: 'text-emerald-500', sign: '+' },
    { label: 'Spent so far', cents: p.spentSoFarCents, tone: 'text-foreground', sign: '−' },
    { label: 'Bills still coming', cents: p.upcomingBillsCents, tone: 'text-foreground', sign: '−' },
    { label: 'Planned savings', cents: p.plannedSavingsCents, tone: 'text-foreground', sign: '−' },
  ];

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

        {/* allocation bar + visible legend (ROADMAP ALSO CONSIDER; title= alone is
            mouse-only — match investments-view's dot+label pattern). */}
        <div
          className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
          data-testid="spending-plan-bar"
          aria-hidden
        >
          <div className="bg-rose-400/80" style={{ width: pct(p.spentSoFarCents) }} />
          <div className="bg-amber-400/80" style={{ width: pct(p.upcomingBillsCents) }} />
          <div className="bg-sky-400/80" style={{ width: pct(p.plannedSavingsCents) }} />
          <div className="bg-emerald-500/80" style={{ width: leftWidth }} />
        </div>
        <ul
          className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
          data-testid="spending-plan-legend"
        >
          <li className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-rose-400/80" aria-hidden /> Spent
          </li>
          <li className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-amber-400/80" aria-hidden /> Bills due
          </li>
          <li className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-sky-400/80" aria-hidden /> Savings
          </li>
          <li className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full bg-emerald-500/80" aria-hidden />{' '}
            {positive ? 'Left to spend' : 'Over plan'}
          </li>
        </ul>
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
