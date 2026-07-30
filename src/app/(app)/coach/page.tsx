import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MERCHANT_LINK_CLASS, merchantRegisterHref } from '@/lib/engine/transactions/links';
import { CheckCircle2, Eye, ShieldCheck, TrendingUp } from 'lucide-react';
import { auth } from '@/auth';
import { AutomationBlueprintCard } from '@/components/coach/automation-blueprint-card';
import { FICard } from '@/components/coach/fi-card';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { withheldInlineNote } from '@/lib/providers/currency';
import { FROZEN_RUNWAY_TESTID, frozenTotalNote } from '@/lib/engine/account/feed-dropped-view';
import { LifeEnergyCard } from '@/components/coach/life-energy-card';
import { MoneySignatureCard } from '@/components/coach/money-signature-card';
import { HabitStreaksCard } from '@/components/coach/habit-streaks-card';
import { SavingsRateCard } from '@/components/coach/savings-rate-card';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyCoach } from '@/components/onboarding/route-empty';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { formatMonth } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { prisma } from '@/lib/db';
import { receiptLines, receiptsFromOpportunities } from '@/lib/engine/receipts/receipts';
import { getCoachData } from '@/server/coach';
import { getValueReceiptsSummary, recordReceipts } from '@/server/receipts';
import { getWithheldAccountSummary } from '@/server/transactions';

export const metadata = { title: "Coach" };

export default async function CoachPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  // No accounts yet → route-framed onboarding (the FI/cash engine needs accounts).
  if ((await prisma.account.count({ where: { userId: session.user.id, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyCoach />;
  const [data, withheld] = await Promise.all([
    getCoachData(session.user.id, { orderReview: true }),
    getWithheldAccountSummary(session.user.id),
  ]);
  // Value receipts (TASKS 1.3): /coach is where price-increase flags are surfaced, so
  // it mints their receipts (key-dedup → idempotent, one row per increase ever), then
  // reads the cumulative tally. Reminder/radar receipts are minted by their delivery
  // crons; this only ever adds rows for newly detected increases.
  await recordReceipts(session.user.id, receiptsFromOpportunities(data.opportunities));
  const receipts = await getValueReceiptsSummary(session.user.id);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">FI Coach</h1>

      {/* currency-guard disclosure (#135 residual): withheld non-USD accounts must not
          vanish silently. Renders nothing for all-USD users (the overwhelming case). */}
      <CurrencyExclusionBanner summary={withheld} />

      <div className="grid gap-4 lg:grid-cols-2">
        <SavingsRateCard flows={data.flows} currentRateBps={data.currentRateBps} />
        <FICard
          fiNumberCents={data.fi.fiNumberCents}
          annualExpensesCents={data.fi.annualExpensesCents}
          portfolioCents={data.fi.portfolioCents}
          monthlyIncomeCents={data.fi.monthlyIncomeCents}
          monthlySavingsCents={data.fi.monthlySavingsCents}
          monthsToFINow={data.fi.monthsToFI}
          swrBps={data.fi.swrBps}
          expectedReturnBps={data.fi.expectedReturnBps}
          coastIsCoast={data.fi.coastIsCoast}
          coastRequiredMonthlyCents={data.fi.coastRequiredMonthlyCents}
          coastTargetYears={data.fi.coastTargetYears}
          latestMonthRateBps={data.currentRateBps}
          latestMonthLabel={
            data.flows.length ? formatMonth(data.flows[data.flows.length - 1].month) : undefined
          }
          currencyNote={withheldInlineNote(withheld)}
          // TASKS L.18 — only the INVESTMENT rows, because only they are inside the portfolio the
          // projections start from. `figureLabel` names this card's own figures rather than a
          // position on it: the note sits under years-to-FI but the Coast line and the slider run
          // off the same number, and a sentence saying "below" would go stale the moment the card
          // is reordered.
          frozenPortfolioNote={frozenTotalNote(data.frozenBalances.portfolio, {
            figureLabel: 'the portfolio these projections start from',
            nextStep: 'accounts-route',
          })}
        />
      </div>

      {/* #252 Money Signature — habit patterns + this-month weather, facts inline */}
      <MoneySignatureCard
        signature={data.signature}
        // The weather line is the runway wearing a mood, so it takes the same CASH-side note the
        // runway card does — one figure, one claim, two places it is printed (critic P2-1).
        frozenCashNote={frozenTotalNote(data.frozenBalances.liquid, {
          figureLabel: 'the cash behind this reading',
          nextStep: 'accounts-route',
        })}
      />

      {/* #254 Habit streaks — cleared-in-full + no-subscription-creep, basis inline */}
      <HabitStreaksCard cardCleared={data.streaks.cardCleared} noCreep={data.streaks.noCreep} />

      {/* O.15 — outstanding reimbursements: purchases the reader marked as
          awaiting money back. Amounts copied verbatim (notify/select idiom);
          the figure links to exactly the rows it counts (no dead ends). */}
      {data.outstandingReimbursements.count > 0 && (
        <Card data-testid="outstanding-reimbursements-card">
          <CardHeader className="pb-2">
            <CardDescription>Money you&apos;re owed back</CardDescription>
            <CardTitle className="text-base" data-testid="outstanding-reimbursements-total">
              {formatCents(data.outstandingReimbursements.totalCents)} awaiting reimbursement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {data.outstandingReimbursements.count === 1
                ? 'One purchase you marked as awaiting reimbursement.'
                : `${data.outstandingReimbursements.count} purchases you marked as awaiting reimbursement.`}{' '}
              They still count as spending until the money comes back.{' '}
              <Link
                href="/transactions?reimb=awaiting"
                className="underline underline-offset-2 hover:text-foreground"
                data-testid="outstanding-reimbursements-link"
              >
                See them
              </Link>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Big wins, never latte shame */}
      <Card data-testid="opportunities-card">
        <CardHeader className="pb-2">
          <CardDescription>Savings opportunities — big wins first</CardDescription>
          <CardTitle className="text-base">
            Worth a look ({data.opportunities.length})
          </CardTitle>
          {data.moneyDials.length > 0 && (
            <p className="text-sm text-muted-foreground">{COACH_COPY.moneyDials(data.moneyDials)}</p>
          )}
        </CardHeader>
        <CardContent>
          {data.opportunities.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground" data-testid="opportunities-empty">
              Nothing to flag right now — check back after a few more weeks of spending data.
            </p>
          ) : (
            <ul className="space-y-3 text-sm" data-testid="opportunities-list">
              {data.opportunities.map((o, i) => (
                <li key={i} className="space-y-0.5">
                  {/* min-w-0: the name below truncates, and a truncating flex child
                      with default min-width:auto pushes the shrink-0 badge off the row
                      instead of clipping itself (the iOS flexbox lesson, and the rule
                      this slice's own builder docblock states). */}
                  <div className="flex min-w-0 items-baseline justify-between gap-2">
                    {/* Same Merchant-Lens entry the register row uses (DECISIONS #250):
                        the flagged name opens the merchant-filtered register, so the
                        reader can see the charges behind the claim in one tap. */}
                    <Link
                      href={merchantRegisterHref(o.merchant)}
                      data-testid="coach-opportunity-link"
                      className={`truncate ${MERCHANT_LINK_CLASS}`}
                    >
                      {o.merchant}
                    </Link>
                    <Badge variant={o.isEstimate ? 'outline' : 'secondary'} className="shrink-0">
                      {o.isEstimate ? `~${formatCents(o.monthlyCents)}/mo est.` : `${formatCents(o.monthlyCents)}/mo`}
                    </Badge>
                  </div>
                  {i === 0 && (
                    <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400" data-testid="biggest-lever">
                      {COACH_COPY.biggestLever()}
                    </p>
                  )}
                  {/* the actionable line first; the compounding math in a quiet second line */}
                  <p className="text-xs text-muted-foreground">
                    {COACH_COPY.opportunity(o, data.fi.expectedReturnBps)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="creep-card">
          <CardHeader className="pb-2">
            <CardDescription>Lifestyle creep</CardDescription>
            <CardTitle className="text-base">
              {/* The verdict is a claim about a set of transactions, so the title IS
                  the way into that set: flagged → the spending it indicts; clear →
                  the income it tracks. Same register links every other surface uses. */}
              <Link
                href={data.creep.flagged ? '/transactions?type=expense' : '/transactions?type=income'}
                data-testid="coach-creep-link"
                className="underline-offset-2 hover:underline"
              >
                {data.creep.flagged ? 'Spending is outpacing income' : 'Tracking income'}
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm" data-testid="creep-verdict">
              {data.creep.flagged ? COACH_COPY.creepFlagged(data.creep) : COACH_COPY.creepClear(data.creep)}
            </p>
            <div className="flex h-14 items-end gap-1" role="img" aria-label="Monthly discretionary spend">
              {data.creep.monthlyDiscretionaryCents.map((m) => {
                const max = Math.max(...data.creep.monthlyDiscretionaryCents.map((x) => x.amountCents), 1);
                return (
                  <div
                    key={m.month}
                    className="flex-1 rounded-sm bg-amber-500/70"
                    style={{ height: `${Math.max(4, Math.round((m.amountCents / max) * 52))}px` }}
                    title={`${m.month}: ${formatCents(m.amountCents)}`}
                  />
                );
              })}
            </div>
            {(() => {
              const series = data.creep.monthlyDiscretionaryCents;
              const first = series[0];
              const last = series[series.length - 1];
              if (!first || !last) return null;
              return (
                <div className="flex justify-between text-[10px] text-muted-foreground" data-testid="creep-axis">
                  <span>
                    {formatMonth(first.month, 'short')} · {formatCents(first.amountCents)}
                  </span>
                  <span>
                    {formatMonth(last.month, 'short')} · {formatCents(last.amountCents)}
                  </span>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <Card data-testid="runway-card">
          <CardHeader className="pb-2">
            <CardDescription>Room for error</CardDescription>
            <CardTitle className="text-2xl tabular-nums" data-testid="runway-months">
              {Number.isFinite(data.runwayMonths) ? `${data.runwayMonths} months` : 'no expenses yet'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{COACH_COPY.runway(data.runwayMonths)}</p>
            {/* TASKS L.18 — the CHECKING/SAVINGS rows only: runway is cash ÷ average expenses, so a
                frozen brokerage does not touch it and a frozen savings account is most of it. */}
            {(() => {
              const note = frozenTotalNote(data.frozenBalances.liquid, {
                figureLabel: 'the cash side of this estimate',
                nextStep: 'accounts-route',
              });
              return note ? (
                <p className="mt-1 text-xs text-amber-500" data-testid={FROZEN_RUNWAY_TESTID}>
                  {note}
                </p>
              ) : null;
            })()}
          </CardContent>
        </Card>
      </div>

      <AutomationBlueprintCard steps={data.blueprint} />

      <LifeEnergyCard items={data.lifeEnergy} hourlyWageCents={data.hourlyWageCents} />

      {/* What Aimplifi caught (TASKS 1.3) — the cumulative value-receipts tally.
          Honest by construction: counts + per-kind totals of what was surfaced,
          never an outcome or "saved you $X" claim. Hidden until there's a catch. */}
      {receipts.total > 0 && (
        <Card data-testid="value-receipts-card">
          <CardHeader className="pb-2">
            <CardDescription>What Aimplifi caught</CardDescription>
            <CardTitle className="text-base" data-testid="value-receipts-headline">
              {COACH_COPY.receiptsHeadline(receipts.total)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ul className="space-y-2" data-testid="value-receipts-lines">
              {receiptLines(receipts).map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{COACH_COPY.receiptsFooter()}</p>
          </CardContent>
        </Card>
      )}

      <Card data-testid="money-review-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardDescription>Monthly Money Review</CardDescription>
            {data.reviewPersonalized && (
              <span
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                data-testid="review-personalized-badge"
              >
                {COACH_COPY.reviewPersonalizedBadge()}
              </span>
            )}
          </div>
          <CardTitle className="text-base">{formatMonth(data.review.month)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.reviewLines.map((r) => {
            // Legacy per-role test ids (improvement/watch/action → improvement/creep/next-action)
            // keep the shipped /coach e2e green; the deterministic floor renders exactly these three.
            const testId =
              r.role === 'watch' ? 'review-creep' : r.role === 'action' ? 'review-next-action' : 'review-improvement';
            const Icon = r.role === 'watch' ? Eye : r.role === 'action' ? CheckCircle2 : TrendingUp;
            const tone = r.role === 'watch' ? 'text-amber-500' : 'text-emerald-500';
            return (
              <p key={r.id} className="flex items-start gap-2" data-testid={testId}>
                <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden />
                <span>{r.line}</span>
              </p>
            );
          })}
        </CardContent>
      </Card>

      {/* Your money rules — a short rulebook beats a perfect plan you won't keep
          (Aliche · Get Good with Money; Sethi · your money rules) */}
      <Card data-testid="money-rules-card">
        <CardHeader className="pb-2">
          <CardDescription>Your money rules</CardDescription>
          <CardTitle className="text-base">A few rules you keep</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="money-rules">
            {COACH_COPY.moneyRules(data.moneyDials)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
