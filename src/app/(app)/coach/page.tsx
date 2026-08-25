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
import { LifestyleCreepChart } from '@/components/coach/lifestyle-creep-chart';
import { SavingsRateCard } from '@/components/coach/savings-rate-card';
import { StayingWealthyCard } from '@/components/coach/staying-wealthy-card';
import { NextDollarCard } from '@/components/coach/next-dollar-card';
import { RichLifeEcho } from '@/components/coach/rich-life-echo';
import { WealthTargetCard } from '@/components/coach/wealth-target-card';
import { composeStayingWealthy } from '@/lib/engine/fi/staying-wealthy';
import { getSpendingPlan } from '@/server/spending-plan';
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
import { runwayTitle } from '@/lib/engine/fi/insights';
import { wealthContributionBasis } from '@/lib/engine/fi/discretionary-cuts';
import { formatMonth } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { prisma } from '@/lib/db';
import { receiptLines, receiptsFromOpportunities } from '@/lib/engine/receipts/receipts';
import { getCoachData } from '@/server/coach';
import { loanPaymentBasisSentence } from '@/server/loan-payment-basis';
import { getValueReceiptsSummary, recordReceipts } from '@/server/receipts';
import { getWithheldAccountSummary } from '@/server/transactions';

export const metadata = { title: "Coach" };

export default async function CoachPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  // No accounts yet → route-framed onboarding (the FI/cash engine needs accounts).
  if ((await prisma.account.count({ where: { userId: session.user.id, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyCoach />;
  const [data, withheld, plan] = await Promise.all([
    getCoachData(session.user.id, { orderReview: true, cutImpact: true }),
    getWithheldAccountSummary(session.user.id),
    // The wealth-target card answers affordability against the SAME safe-to-spend the
    // /spending-plan view prints, and deflates by the SAME inflation dial the /investments
    // outlook uses — the inverse-planner grounding idiom (server/assistant.ts:566).
    getSpendingPlan(session.user.id),
    // W.2 removed a fourth query here that re-read `User.inflationBps` for the wealth card
    // alone. `getCoachData` already loads the user row and now needs the dial itself, so both
    // cards read the one value it returns — two reads of one column is how two cards on one
    // page come to print two different rates.
  ]);
  // Value receipts (TASKS 1.3): /coach is where price-increase flags are surfaced, so
  // it mints their receipts (key-dedup → idempotent, one row per increase ever), then
  // reads the cumulative tally. Reminder/radar receipts are minted by their delivery
  // crons; this only ever adds rows for newly detected increases.
  await recordReceipts(session.user.id, receiptsFromOpportunities(data.opportunities));
  const receipts = await getValueReceiptsSummary(session.user.id);
  // W.13 — who chose the two rates every projection on this page is worked out from. Built
  // ONCE and handed to both cards and the opportunity basis, because the three surfaces print
  // the same two numbers and a possessive that disagrees between them is a reader watching one
  // card call 7.00% theirs while the next calls it ours. `getCoachData` decides both flags: the
  // inflation one from a null column, the return one by value (`returnIsAppDefault`).
  const dialOwnership = {
    returnIsDefault: data.fi.returnIsDefault,
    inflationIsDefault: data.fi.inflationIsDefault,
  };
  // #375 — years dial compounds from Settings/Plan savings % when set; else recent surplus.
  const wealthContribution = wealthContributionBasis({
    historicalMonthlySavingsCents: data.fi.monthlySavingsCents,
    plannedSavingsCents: plan.plannedSavingsCents,
    savingsTargetBps: plan.savingsTargetBps,
  });
  // O.20g — title, body and link for the lifestyle-creep card, selected together
  // in one engine call so they cannot disagree about which of the three verdicts
  // this reader is in.
  const creepCard = COACH_COPY.creepCard(data.creep);
  // P.1 radiation — same authors Ask uses. Empty list: no sentence (Ask's
  // formatter returns before the CFs; "Acting on all 0 of them" would be a
  // fabricated effect). Null copy: render nothing (honest null).
  const cutMerchantCount = new Set(data.opportunities.map((o) => o.merchant)).size;
  const cutHasEstimate = data.opportunities.some((o) => o.isEstimate);
  const cutFiSentence =
    data.opportunities.length > 0 && data.cutCounterfactual
      ? COACH_COPY.cutCounterfactual(
          cutMerchantCount,
          data.cutCounterfactual.cutMonthlyCents,
          data.cutCounterfactual.result,
          cutHasEstimate,
        )
      : null;
  const cutRadarSentence =
    data.opportunities.length > 0 && data.radarCounterfactual
      ? COACH_COPY.cutRadarCounterfactual(data.radarCounterfactual)
      : null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">FI Coach</h1>

      {/* P1.3 — the reader's own one-line Rich Life, quiet atop the page. Only
          set (and only writable) by the same person; no line when unset. */}
      <RichLifeEcho vision={data.richLifeVision} />

      {/* currency-guard disclosure (#135 residual): withheld non-USD accounts must not
          vanish silently. Renders nothing for all-USD users (the overwhelming case). */}
      <CurrencyExclusionBanner summary={withheld} />

      {/* C.25 (#403, critic P1-5): the savings rate, creep baseline and FI
          number all read flows the exclusion moved — name what left, or say
          nothing when nothing did. The sentence claims these figures only
          (O.18e-FU): a universal "loan payments are not spending" could not
          survive a surface that lists the rows, so every surface scopes its
          claim. */}
      {data.loanPaymentExclusions.map((e, i) => (
        <p key={`${e.payee}:${e.loanName}:${e.paymentCents}:${i}`} className="text-xs text-muted-foreground" data-testid="coach-loan-payment-basis">
          {loanPaymentBasisSentence(e, 'figures')}
        </p>
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <SavingsRateCard
          flows={data.flows}
          streak={data.streak}
          currentRateBps={data.currentRateBps}
          monthFlows={data.monthFlows}
          savingsTargetBps={data.savingsTargetBps}
        />
        <FICard
          fiNumberCents={data.fi.fiNumberCents}
          annualExpensesCents={data.fi.annualExpensesCents}
          portfolioCents={data.fi.portfolioCents}
          monthlyIncomeCents={data.fi.monthlyIncomeCents}
          monthlySavingsCents={data.fi.monthlySavingsCents}
          // C.9 (#405) — the real window the FI figure was scaled from and the slider pace was
          // averaged over; verbatim from the server that did the dividing.
          monthlySavingsMonths={data.fi.monthlySavingsMonths}
          monthsToFINow={data.fi.monthsToFI}
          swrBps={data.fi.swrBps}
          expectedReturnBps={data.fi.expectedReturnBps}
          // W.2 — the real rate the server's own monthsToFI/coastFI compounded at, plus the
          // operands the basis line names. All four come from `getCoachData`, which is where
          // the dates were computed, so the card cannot describe a basis its figures did not use.
          projectionReturnBps={data.fi.projectionReturnBps}
          inflationBps={data.fi.inflationBps}
          dialOwnership={dialOwnership}
          realReturnFloored={data.fi.realReturnFloored}
          coastIsCoast={data.fi.coastIsCoast}
          coastRequiredMonthlyCents={data.fi.coastRequiredMonthlyCents}
          coastTargetYears={data.fi.coastTargetYears}
          coastTargetYearsIsAppDefault={data.fi.coastTargetYearsIsAppDefault}
          drawdown={data.fi.drawdown}
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

      {/* P1.2 — staying wealthy is a different skill from the FI growth story
          above. Same three engines the runway / habit-streaks / creep cards
          already run; the row composes them and never claims all three. */}
      <StayingWealthyCard
        row={composeStayingWealthy({
          cardCleared: data.streaks.cardCleared,
          runwayMonths: data.runwayMonths,
          creep: data.creep,
        })}
      />

      {/* W.6(b) — extra-dollar ranking from rates on file. After staying
          wealthy (survival) and before the wealth-target planner. */}
      <NextDollarCard plan={data.nextDollar} />

      {/* Wealth target — the reader states a number ("$10M") and a horizon; the card answers
          both directions (when the current pace arrives, what a chosen date requires) in
          TODAY'S dollars at the real return. Since W.2 the FI card above runs on that same
          basis, so this card's reconciliation line names the difference that remains — the
          destination, not the arithmetic. Both cards take the inflation dial from
          `data.fi`, one read, so they cannot print two different rates for one setting. */}
      <WealthTargetCard
        portfolioCents={data.fi.portfolioCents}
        monthlySavingsCents={cents(wealthContribution.contributionCents)}
        monthlyIncomeCents={data.fi.monthlyIncomeCents}
        safeToSpendCents={cents(plan.leftToSpendCents)}
        expectedReturnBps={data.fi.expectedReturnBps}
        inflationBps={data.fi.inflationBps}
        dialOwnership={dialOwnership}
        monthlySavingsMonths={data.fi.monthlySavingsMonths}
        contributionBasis={wealthContribution.basis}
        savingsTargetBps={plan.savingsTargetBps}
        historicalMonthlySavingsCents={data.fi.monthlySavingsCents}
        discretionaryCategorySpend={data.discretionaryCategorySpend}
        moneyDials={data.moneyDialIds}
        // Same note the FI card above already carries: a withheld non-USD investment account is
        // absent from `portfolioCents`, and the starting-balance sentence enumerates exclusions.
        currencyNote={withheldInlineNote(withheld)}
        // The TARGET starts from nothing — it is what the reader typed. What starts from the
        // portfolio is every projection on the card, including the required-contribution
        // instruction, which a balance frozen HIGH makes too small.
        frozenPortfolioNote={frozenTotalNote(data.frozenBalances.portfolio, {
          figureLabel: 'the portfolio these projections start from',
          nextStep: 'accounts-route',
        })}
      />

      {/* #252 Money Signature — habit patterns + this-month weather, facts inline */}
      <MoneySignatureCard
        signature={data.signature}
        // C.9 (#405) — the cushion names the window the average expenses divide by; verbatim
        // from the server, like the runway figure it qualifies.
        expenseWindowMonths={data.fi.monthlySavingsMonths}
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
                    <p className="text-xs font-medium text-positive-600 dark:text-positive-400" data-testid="biggest-lever">
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
          {/* W.10 — how the figures in the rows were worked out, once for the list. Rendered
              only beside rows: with an empty list there is no figure for it to qualify, and a
              basis sentence under "nothing to flag" describes money nobody was shown. The two
              gates are the SAME predicate deliberately, and a test asserts the absence. */}
          {cutFiSentence && (
            <p className="mt-4 text-sm break-words" data-testid="opportunities-cut-fi">
              {cutFiSentence}
            </p>
          )}
          {cutRadarSentence && (
            <p className="mt-2 text-xs text-muted-foreground break-words" data-testid="opportunities-cut-radar">
              {cutRadarSentence}
            </p>
          )}
          {data.opportunities.length > 0 && (
            <p className="mt-4 text-xs text-muted-foreground" data-testid="opportunities-basis">
              {COACH_COPY.opportunityBasis(
                data.fi.expectedReturnBps,
                data.fi.inflationBps,
                dialOwnership,
              )}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="creep-card">
          <CardHeader className="pb-2">
            <CardDescription>Lifestyle creep</CardDescription>
            <CardTitle className="text-base">
              {/* Audit P2: the verdict is a CLAIM about a set of transactions, so it
                  must not be the thing you click — a link on a claim reads as the
                  claim being clickable proof. The title states the verdict; the link
                  below claims only the register filter that opens the set.

                  O.20g: the verdict has THREE states — the third is the window the
                  app cannot compare, which used to render as "Tracking income".
                  Title, body and link are selected together in the engine, because
                  a three-way rule in a .tsx cannot be locked by a test and these
                  three must never disagree about which state they are in. */}
              <span data-testid="creep-title">{creepCard.title}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm" data-testid="creep-verdict">
              {creepCard.body}
            </p>
            <Link
              href={creepCard.linkHref}
              data-testid="coach-creep-link"
              className="text-xs underline underline-offset-2 hover:text-foreground"
            >
              {creepCard.linkLabel}
            </Link>
            {/* O.20d: every bar opens the purchases the month figure was summed
                from — the strip is now a set of real controls. */}
            <LifestyleCreepChart creep={data.creep} />
          </CardContent>
        </Card>

        <Card data-testid="runway-card">
          <CardHeader className="pb-2">
            <CardDescription>Room for error</CardDescription>
            <CardTitle className="text-2xl tabular-nums" data-testid="runway-months">
              {/* Audit P2: a negative runway has no month count to state as a
                  fact — the body sentence below names what negative means. */}
              {runwayTitle(data.runwayMonths)}
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
                <p className="mt-1 text-xs text-warning-500" data-testid={FROZEN_RUNWAY_TESTID}>
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
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-positive-500" aria-hidden />
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
            const tone = r.role === 'watch' ? 'text-warning-500' : 'text-positive-500';
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
