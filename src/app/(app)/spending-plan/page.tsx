import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { PlanFiguresForm } from '@/components/finance/plan-figures-form';
import { getSpendingPlan } from '@/server/spending-plan';
import { traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import { formatCents } from '@/lib/money';
import { cents } from '@/lib/money';
import { prisma } from '@/lib/db';
import { isDemoUser } from '@/lib/demo-user';

export const metadata = { title: "Spending plan" };

export default async function SpendingPlanPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;

  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  const p = await getSpendingPlan(userId);
  const canEditFigures = !isDemoUser(userId);
  const figuresForm = (
    <PlanFiguresForm
      suggestedIncomeCents={p.suggestedIncomeCents}
      suggestedFixedCents={p.suggestedFixedCents}
      incomeOverrideCents={p.incomeOverrideCents}
      fixedOverrideCents={p.fixedOverrideCents}
      savingsTargetBps={p.savingsTargetBps}
      incomeSlideCents={p.incomeSlideCents}
      fixedSlideCents={p.fixedSlideCents}
      hasSlide={p.hasSlide}
      canEdit={canEditFigures}
    />
  );
  const positive = !p.overspent;
  // Card fields do not create a guilt-free figure (owner 2026-08-01).
  // User-set overrides still produce a plan even with no transaction pattern.
  const noData =
    p.patternIncomeCents === 0 &&
    p.fixedExpensesCents === 0 &&
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
            Once we can see your income — a complete month posted, a recurring paycheck
            detected, or figures you set below — your guilt-free amount shows up here.
          </p>
        </section>
        {figuresForm}
      </div>
    );
  }

  const total = Math.max(1, p.patternIncomeCents);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`;
  const leftWidth = pct(Math.max(0, p.leftToSpendCents));
  const d = p.disclosures;

  const trace = traceSafeToSpend(p, d);
  const rows = trace.rows.map((r) => ({
    label: r.isEstimated ? `${r.label} (estimated)` : r.label,
    action: r.action,
    cents: Math.abs(r.amountCents),
    tone: r.id === 'income' ? 'text-emerald-500' : 'text-foreground',
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
      <section
        data-testid="spending-plan-hero"
        className="rounded-2xl border bg-gradient-to-br from-card to-accent/30 p-6 text-center shadow-sm"
      >
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
              your monthly allocation after fixed costs and savings — the{' '}
              <em>I Will Teach You to Be Rich</em> guilt-free figure
            </>
          ) : (
            <>Your income pattern is more than spoken for by fixed costs and savings — the plan
            below shows which line drives it.</>
          )}
        </p>

        <div
          className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label="Allocation of monthly income: fixed expenses, savings, guilt-free"
        >
          <div className="bg-amber-400/80" style={{ width: pct(p.fixedExpensesCents) }} title="Fixed expenses" />
          <div className="bg-sky-400/80" style={{ width: pct(p.plannedSavingsCents) }} title="Savings" />
          <div className="bg-emerald-500/80" style={{ width: leftWidth }} title="Guilt-free" />
        </div>
        <ul
          data-testid="spending-plan-legend"
          className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          {(
            [
              { swatch: 'bg-amber-400/80', label: 'Fixed expenses' },
              { swatch: 'bg-sky-400/80', label: 'Savings' },
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

      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">How we got there</h2>
        <dl className="divide-y text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3 py-2" data-testid="plan-row">
              <dt className="min-w-0 text-muted-foreground" data-testid="plan-row-label">
                {r.label}
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
            These {rows.length}{' '}
            lines add up to exactly the &ldquo;Guilt-free to spend&rdquo;
            amount — matched to the penny from your own data.
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
          Income − savings% − non-discretionary fixed (groceries and bills in; dining out out).
          Card payments settle spend already counted; cash needed for them lives on Home.
          {p.savingsTargetBps == null && p.plannedSavingsCents > 0 ? (
            <> Set a savings target in Settings to reserve a share of income first.</>
          ) : null}
        </p>
      </section>

      {figuresForm}

      <section
        className="rounded-2xl border bg-card p-5 shadow-sm"
        data-testid="spending-plan-how-to-use"
      >
        <h2 className="mb-2 text-sm font-semibold">Using Aim·plifi</h2>
        <ol className="list-decimal space-y-1.5 pl-4 text-xs text-muted-foreground">
          <li>
            <Link href="/triage" className="underline underline-offset-2 hover:text-foreground">
              File transactions
            </Link>{' '}
            so income, transfers, and bills land in the right buckets.
          </li>
          <li>
            Set savings % under <span className="text-foreground">Your plan</span> (or{' '}
            <Link href="/settings" className="underline underline-offset-2 hover:text-foreground">
              Settings
            </Link>
            ). Income and fixed follow categories; lock them only as intention — later
            differences show as a slide.
          </li>
          <li>
            Mark categories Fixed or Guilt-free on{' '}
            <Link href="/budgets" className="underline underline-offset-2 hover:text-foreground">
              Spending
            </Link>
            . Guilt-free = income − savings% − fixed. Dining out and golf start as
            guilt-free; groceries and bills start as fixed — change any that are wrong.
          </li>
        </ol>
      </section>

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
        </ul>
      </section>
    </div>
  );
}
