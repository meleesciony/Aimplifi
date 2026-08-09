import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyGoals } from '@/components/onboarding/route-empty';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { prisma } from '@/lib/db';
import { goalFIImpact } from '@/lib/engine/goals';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { frozenTotalNote } from '@/lib/engine/account/feed-dropped-view';
import { formatMonth } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { getCoachData } from '@/server/coach';
import { loadDebtAccounts } from '@/server/debt';
import { DeleteGoalButton } from '@/components/finance/delete-goal-button';
import { DebtFreedomPlanner } from '@/components/finance/debt-freedom-planner';
import { GoalForm } from '@/components/finance/goal-form';

export const metadata = { title: "Goals" };

export default async function GoalsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  // No accounts yet → route-framed onboarding; getCoachData throws on empty (DECISIONS #44).
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyGoals />;
  const [goals, coach, debts] = await Promise.all([
    // Reserves (C.23/H.4) share the Goal table and are NOT goals: they pre-fund
    // an expense rather than build wealth, they carry no monthly contribution,
    // and every card on this page states an effect on the reader's FI date —
    // which a reserve does not have and which `goalFIImpact` would compute from
    // a null contribution as though it did. They live on the Plan page, beside
    // the fixed total they are part of.
    prisma.goal.findMany({
      where: {
        userId,
      // NOT `kind: { not: RESERVE_KIND }`. SQL three-valued logic makes
      // `kind <> 'reserve'` NULL for a `kind IS NULL` row, and an ordinary
      // savings goal is exactly that — so the tidy-looking predicate silently
      // dropped EVERY savings goal (C.23 critic P0-1, executed: a three-goal
      // user saw one). The set this needs is "everything that is not a
      // reserve", and a null is not a reserve.
      OR: [{ kind: null }, { kind: { not: RESERVE_KIND } }],
      },
      orderBy: { name: 'asc' },
    }),
    getCoachData(userId),
    loadDebtAccounts(userId),
  ]);

  const frozenPortfolioNote = frozenTotalNote(coach.frozenBalances.portfolio, {
    figureLabel: 'the portfolio these projections start from',
    nextStep: 'accounts-route',
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Goals</h1>
      <p className="text-sm text-muted-foreground">
        Every goal shows its effect on your FI date, assuming your savings rate
        and expected return stay as they are. Dates here are in today&apos;s money,
        after inflation — the same basis the FI card on Coach uses, so the two
        agree. Goals and FI aren&apos;t enemies — they&apos;re both you, paying
        yourself first.
      </p>
      {/* Audit P2: the FI-effect figures start from coach.fi.portfolioCents —
          the SAME portfolio the FI card on /coach starts from, so the frozen
          qualifier that card carries must ride along here, or this page claims
          a basis /coach itself refuses to claim bare. Same figureLabel as
          /coach, because it is the same figure. */}
      {frozenPortfolioNote && (
        <p className="text-xs text-muted-foreground" data-testid="goals-frozen-note">
          {frozenPortfolioNote}
        </p>
      )}
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
                // W.2 — the REAL rate, matching /coach. `goalFIImpact` runs the same
                // simulation against the same present-value `fiNumberCents`, so the nominal
                // dial produced an FI baseline this reader never saw on the card they just
                // left (measured: 181 months here vs 221 on /coach).
                annualReturnBps: coach.fi.projectionReturnBps,
                fiTargetCents: coach.fi.fiNumberCents,
                goalRemainingCents: target,
                goalMonthlyContributionCents: cents(50000),
              });
              return (
                <p>
                  At $500/mo this would be funded in ~{impact.monthsToGoal} months, and it{' '}
                  {/* C.14 (audit #22): the mirror of the card bug — `?? 0` turned
                      the null state into a fabricated "~0 months". Same three
                      states as the real cards, so the example cannot drift. */}
                  {impact.fiDelayMonths === null
                    ? COACH_COPY.goalFiBeyondHorizon()
                    : impact.fiDelayMonths === 0
                      ? "wouldn't move your FI date"
                      : `would move your FI date back ~${impact.fiDelayMonths} months`}{' '}
                  (assuming your current savings rate and expected return). Add your own below —
                  every goal shows its real FI effect.
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
            // W.2 — the REAL rate, matching /coach (see the sibling call above).
            annualReturnBps: coach.fi.projectionReturnBps,
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
                    {/* C.14 (audit #22): THREE states, not two. `fiDelayMonths`
                        is null when the FI date (with or without the goal) sits
                        past the engine's 1200-month cap — the old `=== 0` branch
                        let that state fall into the template and printed the
                        literal string "~null months". The refusal names it, the
                        same shape as the FI card's beyondProjectionHorizon. */}
                    {impact.fiDelayMonths === null
                      ? COACH_COPY.goalFiBeyondHorizon()
                      : impact.fiDelayMonths === 0
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
          <GoalForm />
        </CardContent>
      </Card>

      <p className="px-1 text-xs text-muted-foreground" data-testid="assumptions-change">
        {COACH_COPY.assumptionsChange()}
      </p>
    </div>
  );
}
