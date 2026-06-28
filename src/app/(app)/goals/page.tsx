import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { prisma } from '@/lib/db';
import { goalFIImpact } from '@/lib/engine/goals';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { formatMonth } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { getCoachData } from '@/server/coach';
import { loadDebtAccounts } from '@/server/debt';
import { DeleteGoalButton } from '@/components/finance/delete-goal-button';
import { DebtFreedomPlanner } from '@/components/finance/debt-freedom-planner';
import { createGoal } from '@/server/goal-actions';

export const metadata = { title: "Goals" };

export default async function GoalsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  // No accounts yet → onboarding; getCoachData runs the cash engine which throws on empty (DECISIONS #44).
  if ((await prisma.account.count({ where: { userId } })) === 0) return <EmptyDashboard />;
  const [goals, coach, debts] = await Promise.all([
    prisma.goal.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
    getCoachData(userId),
    loadDebtAccounts(userId),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Goals</h1>
      <p className="text-sm text-muted-foreground">
        Every goal shows its effect on your FI date, assuming your savings rate
        and expected return stay as they are. Goals and FI aren&apos;t enemies —
        they&apos;re both you, paying yourself first.
      </p>
      <p className="text-xs text-muted-foreground" data-testid="cushion-is-a-goal">
        {COACH_COPY.cushionIsAGoal()}
      </p>

      {goals.length === 0 && (
        <Card className="border-dashed" data-testid="goals-empty-example">
          <CardHeader className="pb-2">
            <CardDescription>Worked example — what this page does</CardDescription>
            <CardTitle className="text-base">
              Emergency fund: {formatCents(cents(Math.round(coach.fi.annualExpensesCents / 2)))} (6
              months of expenses)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {(() => {
              const target = cents(Math.round(coach.fi.annualExpensesCents / 2));
              const impact = goalFIImpact({
                portfolioCents: coach.fi.portfolioCents,
                monthlySavingsCents: coach.fi.monthlySavingsCents,
                annualReturnBps: coach.fi.expectedReturnBps,
                fiTargetCents: coach.fi.fiNumberCents,
                goalRemainingCents: target,
                goalMonthlyContributionCents: cents(50000),
              });
              return (
                <p>
                  At $500/mo this would be funded in ~{impact.monthsToGoal} months and would move
                  your FI date back ~{impact.fiDelayMonths ?? 0} months (assuming your current
                  savings rate and expected return). Add your own below — every goal shows its
                  real FI effect.
                </p>
              );
            })()}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2" data-testid="goals-list">
        {goals.map((goal) => {
          // Debt-free-by-date goals (DECISIONS #125) are NOT savings goals — render them with
          // the solver's own date + suggested extra, never goalFIImpact's savings timeline or
          // the "moves your FI date back" framing (which is backwards for paying down debt).
          if (goal.kind === 'debt_free') {
            const extra = goal.monthlyContributionCents ?? 0;
            return (
              <Card key={goal.id} data-testid={`goal-${goal.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{goal.name}</CardTitle>
                    <DeleteGoalButton goalId={goal.id} goalName={goal.name} />
                  </div>
                  <CardDescription>
                    {formatCents(cents(goal.targetCents))} of debt
                    {goal.targetDate ? ` · target ${formatMonth(goal.targetDate.slice(0, 7))}` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm" data-testid="goal-debt-free">
                  <p className="text-muted-foreground">
                    {extra > 0
                      ? `Suggested: about ${formatCents(cents(extra))}/mo on top of your minimums (least-interest order). `
                      : 'On track at your current payments — no extra needed. '}
                    Re-check in Ask Aimplifi as your balances change.
                  </p>
                </CardContent>
              </Card>
            );
          }
          const impact = goalFIImpact({
            portfolioCents: coach.fi.portfolioCents,
            monthlySavingsCents: coach.fi.monthlySavingsCents,
            annualReturnBps: coach.fi.expectedReturnBps,
            fiTargetCents: coach.fi.fiNumberCents,
            goalRemainingCents: cents(Math.max(0, goal.targetCents - goal.savedCents)),
            goalMonthlyContributionCents: cents(goal.monthlyContributionCents ?? 0),
          });
          return (
            <Card key={goal.id} data-testid={`goal-${goal.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{goal.name}</CardTitle>
                  <DeleteGoalButton goalId={goal.id} goalName={goal.name} />
                </div>
                <CardDescription>
                  {formatCents(cents(goal.savedCents))} of {formatCents(cents(goal.targetCents))}
                  {goal.monthlyContributionCents
                    ? ` · ${formatCents(cents(goal.monthlyContributionCents))}/mo`
                    : ''}
                  {/* Savings-goal-by-date goals (DECISIONS #126) carry the target date the user
                      planned toward; existing dateless savings goals are unaffected. */}
                  {goal.targetDate ? ` · by ${formatMonth(goal.targetDate.slice(0, 7))}` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm">
                {impact.monthsToGoal === null ? (
                  <p className="text-muted-foreground">
                    Add a monthly contribution to see the timeline and FI effect.
                  </p>
                ) : (
                  <p data-testid="goal-fi-impact">
                    Funded in ~{impact.monthsToGoal} months.{' '}
                    {impact.fiDelayMonths === 0
                      ? 'No measurable effect on your FI date.'
                      : `Moves your FI date back ~${impact.fiDelayMonths} months — assuming your current savings rate and expected return.`}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {debts.length > 0 && <DebtFreedomPlanner debts={debts} today={coach.today} />}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">New goal</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createGoal} className="flex flex-wrap items-end gap-2" data-testid="goal-form">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Name
              <input
                name="name"
                required
                className="w-40 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                placeholder="Emergency fund"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Target $
              <input
                name="target"
                required
                inputMode="decimal"
                className="w-28 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                placeholder="10000"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Monthly $ (optional)
              <input
                name="monthly"
                inputMode="decimal"
                className="w-28 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
                placeholder="500"
              />
            </label>
            <Button type="submit" size="sm" data-testid="goal-create">
              Add goal
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="px-1 text-xs text-muted-foreground" data-testid="assumptions-change">
        {COACH_COPY.assumptionsChange()}
      </p>
    </div>
  );
}
