import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { PlanFiguresForm } from '@/components/finance/plan-figures-form';
import { PlanRowActionLink } from '@/components/finance/plan-row-action-link';
import { getSpendingPlan } from '@/server/spending-plan';
import { traceSafeToSpend } from '@/lib/engine/glass-box/trace';
import { REVIEW_FIXED_HREF } from '@/lib/engine/spending-plan/fixed-review';
import { HOME_NEEDS_FILE_HREF } from '@/lib/copy/home-needs-file-copy';
import { monthKey } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { cents } from '@/lib/money';
import { prisma } from '@/lib/db';
import { isDemoUser } from '@/lib/demo-user';
import {
  CATEGORY_NAME_LINK_CLASS,
  spendClassMonthRegisterHref,
} from '@/lib/engine/transactions/links';
import { UNNAMED_BILL_LABEL } from '@/lib/engine/spending-plan/fixed-line-items';
import { RESERVE_CADENCE_WORDS } from '@/lib/engine/spending-plan/reserves';
import { ReserveForm } from '@/components/finance/reserve-form';
import { DeleteReserveButton } from '@/components/finance/delete-reserve-button';
import { ReserveNameControl } from '@/components/finance/rename-reserve-form';
import { ReserveCostControl } from '@/components/finance/reserve-cost-form';
import { ReserveCadenceControl } from '@/components/finance/reserve-cadence-form';
import { BillNameControl } from '@/components/finance/rename-bill-form';
import { BillAmountControl } from '@/components/finance/bill-amount-form';
import { TakeBillOffPlanButton } from '@/components/finance/take-bill-off-plan-button';
import { ConvertToReserveButton } from '@/components/finance/convert-to-reserve-button';
import { PutBillBackOnPlanButton } from '@/components/finance/put-bill-back-on-plan-button';

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
      patternFixedCents={p.patternFixedCents}
      reserveMonthlyCents={p.reserveMonthlyCents}
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
    tone: r.id === 'income' ? 'text-positive-500' : 'text-foreground',
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
          {positive ? 'Guilt-free to spend' : 'Over plan'}
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
          <div className="bg-warning-400/80" style={{ width: pct(p.fixedExpensesCents) }} title="Fixed expenses" />
          <div className="bg-sky-400/80" style={{ width: pct(p.plannedSavingsCents) }} title="Savings" />
          <div className="bg-positive-500/80" style={{ width: leftWidth }} title="Guilt-free" />
        </div>
        <ul
          data-testid="spending-plan-legend"
          className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
        >
          {(
            [
              {
                swatch: 'bg-warning-400/80',
                label: 'Fixed expenses',
                href: spendClassMonthRegisterHref({
                  spendClass: 'fixed',
                  month: monthKey(p.today),
                  amountCents: p.fixedExpensesCents,
                }),
                testId: 'plan-legend-fixed',
              },
              { swatch: 'bg-sky-400/80', label: 'Savings', href: null, testId: 'plan-legend-savings' },
              {
                swatch: 'bg-positive-500/80',
                label: 'Guilt-free',
                href: spendClassMonthRegisterHref({
                  spendClass: 'guilt-free',
                  month: monthKey(p.today),
                  amountCents: Math.max(0, p.leftToSpendCents),
                }),
                testId: 'plan-legend-guilt-free',
              },
            ] as const
          ).map((item) => (
            <li key={item.label} className="inline-flex items-center gap-1.5">
              <span className={`size-2 shrink-0 rounded-full ${item.swatch}`} aria-hidden />
              {item.href ? (
                <Link
                  href={item.href}
                  className={CATEGORY_NAME_LINK_CLASS}
                  data-testid={item.testId}
                >
                  {item.label}
                </Link>
              ) : (
                <span data-testid={item.testId}>{item.label}</span>
              )}
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
                    <PlanRowActionLink
                      href={r.action.href}
                      label={r.action.label}
                      className="whitespace-nowrap underline underline-offset-2 hover:text-foreground"
                      testId="plan-row-action"
                    />
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
              className={`text-base font-bold tabular-nums ${positive ? 'text-positive-500' : 'text-red-500'}`}
            >
              {formatCents(cents(trace.sumCents))}
            </dd>
          </div>
        </dl>
        {trace.reconciles ? (
          /* Audit P1-14: "from your own data" is a provenance claim — printed
             only when no term is reader-typed (override, goal, savings target,
             budget-priced category); the engine's `dataDerived` gates it. */
          <p className="mt-3 text-xs text-muted-foreground" data-testid="plan-reconciled">
            These {rows.length}{' '}
            lines add up to exactly the &ldquo;Guilt-free to spend&rdquo;
            amount — matched to the penny{trace.dataDerived ? ' from your own data' : ''}.
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
          Income − savings% − non-discretionary fixed (groceries and bills in; dining out out)
          {p.reserveLines.length > 0 ? ', plus anything you set aside below' : ''}.
          Card payments settle spend already counted; cash needed for them lives on Home.
          {p.savingsTargetBps == null && p.plannedSavingsCents > 0 ? (
            <> Set a savings target in Settings to hold back a share of income first.</>
          ) : null}
        </p>
      </section>

      {/* C.19 / H.3 — owner, four times: "where is mortgage? Fixed expense list
          must include mortgage". The figure always held it (C.24 unions the
          $6,217.07); no list did, because the union contributed a bare number
          while C.24's exactness invariant pulled the merchant's rows out of the
          category rollup — the only half that produced lines. The composition
          is assembled in the engine (`buildFixedList`) and rendered here
          verbatim; this page performs no arithmetic on it. */}
      <section
        className="rounded-2xl border bg-card p-5 shadow-sm"
        data-testid="fixed-composition"
      >
        <h2 className="mb-1 text-sm font-semibold">What makes up your fixed costs</h2>
        {/* NO GENERAL SENTENCE ABOUT HOW THESE AMOUNTS WERE REACHED. The first
            cut carried one, describing the union's monthly smoothing — and the
            copy critic falsified it twice, because most rows here are category
            averages on a different basis entirely. Each line states its own
            basis (`basisNote`) instead; a list from two bases cannot have one
            explanation. */}
        {p.fixedList.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="fixed-composition-empty">
            {p.fixedList.note}
          </p>
        ) : (
          <>
            <dl className="divide-y text-sm">
              {p.fixedList.lines.map((l) => (
                <div
                  key={l.key}
                  className="flex items-center justify-between gap-3 py-2"
                  data-testid="fixed-composition-row"
                >
                  <dt className="min-w-0 text-muted-foreground">
                    {l.kind === 'recurring-bill' && l.billKey ? (
                      <BillNameControl billKey={l.billKey} name={l.label} />
                    ) : (
                      <span data-testid="fixed-composition-label">{l.label}</span>
                    )}
                    {/* The chip is withheld when the label already carries the
                        word — an unnamed bill reads "A recurring bill we
                        detected" and does not need "REPEATING BILL" stamped
                        beside it (the `outOfScopeChipLabel` rule: a chip that
                        repeats its neighbour is clutter, not disclosure). */}
                    {l.kind === 'recurring-bill' &&
                    (l.loanPayment || !l.label.startsWith(UNNAMED_BILL_LABEL)) ? (
                      <span
                        className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                        data-testid="fixed-composition-bill-chip"
                      >
                        {l.loanPayment ? 'loan payment' : 'repeating bill'}
                      </span>
                    ) : null}
                    {/* A reserve is the one line with no transaction behind it,
                        and it sits in a list whose every other row was measured
                        from real spending. Unchipped, the reader has no way to
                        tell their own declaration from a detected bill — and
                        would go looking for a charge that does not exist. */}
                    {l.kind === 'reserve' ? (
                      <span
                        className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                        data-testid="fixed-composition-reserve-chip"
                      >
                        reserve
                      </span>
                    ) : null}
                    {l.basisNote ? (
                      <span className="text-xs" data-testid="fixed-composition-basis">
                        {l.basisNote}
                      </span>
                    ) : null}
                  </dt>
                  <dd className="flex shrink-0 items-center gap-2">
                    {l.kind === 'recurring-bill' &&
                    l.billKey &&
                    !l.loanPayment &&
                    canEditFigures ? (
                      <BillAmountControl billKey={l.billKey} monthlyCents={l.amountCents} />
                    ) : (
                      <span className="tabular-nums" data-testid="fixed-composition-amount">
                        {formatCents(cents(l.amountCents))}
                      </span>
                    )}
                    {l.kind === 'recurring-bill' &&
                    l.billKey &&
                    !l.loanPayment ? (
                      <TakeBillOffPlanButton billKey={l.billKey} billName={l.label} />
                    ) : null}
                    {canEditFigures &&
                    l.kind === 'recurring-bill' &&
                    (() => {
                      const convertBill = p.fixedSetup.bills.find((b) => b.billKey === l.billKey);
                      return convertBill?.convertibleToReserve && convertBill.convertInput ? (
                        <ConvertToReserveButton merchantCanonical={convertBill.billKey} />
                      ) : null;
                    })()}
                  </dd>
                </div>
              ))}
              <div className="flex items-center justify-between py-2.5">
                <dt className="font-semibold">Total of these lines</dt>
                <dd
                  className="text-base font-bold tabular-nums"
                  data-testid="fixed-composition-total"
                >
                  {formatCents(cents(p.fixedList.totalCents))}
                </dd>
              </div>
              {/* Both figures on screen whenever they differ — and only when
                  they actually do. Explaining a gap in prose while showing one
                  number asks the reader to take the difference on trust; the
                  arithmetic is the disclosure. A median basis whose median is 0
                  leaves nothing unlisted, so the second row must not print
                  ($300.00 twice, stacked) — the money critic's P2-1. */}
              {!p.fixedList.reconciles && p.fixedList.unaccountedCents !== 0 ? (

                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-muted-foreground">Fixed costs your plan uses</dt>
                  <dd
                    className="shrink-0 tabular-nums"
                    data-testid="fixed-composition-plan-figure"
                  >
                    {formatCents(cents(p.fixedList.planFixedCents))}
                  </dd>
                </div>
              ) : null}
            </dl>
            <p
              className="mt-3 text-xs text-muted-foreground"
              data-testid={
                p.fixedList.reconciles
                  ? 'fixed-composition-reconciled'
                  : 'fixed-composition-partial'
              }
            >
              {p.fixedList.note}
            </p>
          </>
        )}
        {p.billsTakenOff.length > 0 ? (
          <div className="mt-3" data-testid="bills-taken-off">
            <p className="text-xs text-muted-foreground">Taken off the plan</p>
            <dl className="mt-1 divide-y text-sm">
              {p.billsTakenOff.map((b) => (
                <div
                  key={b.billKey}
                  className="flex items-center justify-between gap-3 py-2"
                  data-testid="bill-taken-off-row"
                >
                  <dt className="min-w-0 text-muted-foreground">{b.label}</dt>
                  <dd className="shrink-0">
                    <PutBillBackOnPlanButton billKey={b.billKey} billName={b.label} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </section>

      {/* C.23 / H.4 — the owner's third source of fixed money, in his words:
          "money being reserved every month for home repair… The way I
          personally categorize yearly membership dues is I divide by 12 and put
          that cash aside." The division is the app's job, so this form asks for
          the WHOLE cost and its rhythm. Placed directly under the Fixed list it
          feeds, because a control belongs beside the figure it moves. */}
      <section
        className="rounded-2xl border bg-card p-5 shadow-sm"
        data-testid="reserves-section"
      >
        <h2 className="mb-1 text-sm font-semibold">Money you set aside each month</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          For costs that are real but haven&apos;t arrived yet — home repair, yearly
          dues, a car service. Tell us the whole cost and how often it comes around;
          we divide it and count the monthly share as a fixed cost, so it isn&apos;t
          sitting in your guilt-free spending looking like money you can spend on
          something else.
        </p>
        {p.reserveLines.length > 0 ? (
          <dl className="mb-3 divide-y text-sm">
            {p.reserveLines.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 py-2"
                data-testid="reserve-row"
              >
                <dt className="min-w-0 text-muted-foreground">
                  <ReserveNameControl reserveId={r.id} name={r.name} />
                  {r.pairedToBill ? (
                    <span className="mt-0.5 block text-xs" data-testid="reserve-row-basis">
                      {formatCents(cents(r.trueCostCents))} {RESERVE_CADENCE_WORDS[r.cadence]}
                    </span>
                  ) : (
                    <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-xs" data-testid="reserve-row-basis">
                      <ReserveCostControl reserveId={r.id} trueCostCents={r.trueCostCents} />
                      <ReserveCadenceControl reserveId={r.id} cadence={r.cadence} />
                    </span>
                  )}
                </dt>
                <dd className="flex shrink-0 items-center gap-2">
                  <span className="tabular-nums" data-testid="reserve-row-monthly">
                    {formatCents(cents(r.monthlyCents))}/mo
                  </span>
                  <DeleteReserveButton reserveId={r.id} reserveName={r.name} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {/* A declaration the plan could not read is money the reader told us
            about and the plan is now spending as though it were free. It is
            named — AND it keeps its remove control, because a row the reader
            cannot see in the list above is a row they cannot act on, and
            "remove it and add it again" would be an instruction with nothing
            to click (`prevention-is-not-a-remedy`). */}
        {p.refusedReserves.length > 0 ? (
          <div className="mb-3" data-testid="reserves-refused">
            {/* The headline states only what is true of EVERY refused row —
                that it is not in the figure, and that removing and re-adding it
                is the remedy. The first cut blamed the amount, which is false
                for a bad cadence and false again for a cost the app read
                perfectly well and found too small; each row states its own
                reason below (`a-disclosure-is-several-claims-in-one-sentence`).
                It also said "what you saved", the one word this whole feature
                argues a reserve is not. */}
            <p className="text-xs text-red-500">
              {p.refusedReserves.length === 1
                ? "One of your reserves isn't in your fixed costs. Remove it and add it again to fix it."
                : `${p.refusedReserves.length} of your reserves aren't in your fixed costs. Remove them and add them again to fix them.`}
            </p>
            <dl className="mt-1 divide-y text-sm">
              {p.refusedReserves.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 py-2"
                  data-testid="reserve-refused-row"
                >
                  <dt className="min-w-0 text-muted-foreground">
                    <span className="text-foreground">{r.name}</span>
                    <span className="mt-0.5 block text-xs">
                      {r.reason === 'bad-cadence'
                        ? "we can't tell how often this cost comes around"
                        : r.reason === 'rounds-to-zero'
                          ? 'spread over the year this comes to less than a cent a month'
                          : "the amount saved isn't a usable figure"}
                    </span>
                  </dt>
                  <dd className="shrink-0">
                    <DeleteReserveButton reserveId={r.id} reserveName={r.name} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
        {/* The shared demo is one row every visitor shares, so a reserve typed
            here would land in the next visitor's fixed costs. The server action
            refuses it either way; hiding the form is the courtesy half, matching
            how the Plan figures form treats the same account. */}
        {canEditFigures ? (
          <ReserveForm />
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="reserves-demo-note">
            The demo is a shared account, so reserves can&apos;t be added here — create your
            own free account to set aside your own money.
          </p>
        )}
      </section>

      {figuresForm}

      <section
        className="rounded-2xl border bg-card p-5 shadow-sm"
        data-testid="spending-plan-how-to-use"
      >
        <h2 className="mb-2 text-sm font-semibold">Using Aimplifi</h2>
        <ol className="list-decimal space-y-1.5 pl-4 text-xs text-muted-foreground">
          <li>
            <Link href={HOME_NEEDS_FILE_HREF} className="underline underline-offset-2 hover:text-foreground">
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
            <Link href={REVIEW_FIXED_HREF} className="underline underline-offset-2 hover:text-foreground">
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
