import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cents, formatCents } from '@/lib/money';
import { UNNAMED_BILL_LABEL } from '@/lib/engine/spending-plan/fixed-line-items';
import { RESERVE_CADENCE_WORDS } from '@/lib/engine/spending-plan/reserves';
import { holdingAccountClause, type SetupBillProposal } from '@/lib/engine/spending-plan/setup-proposals';
import type { SpendingPlanWithNotes } from '@/server/spending-plan';
import { ReserveForm } from '@/components/finance/reserve-form';
import { ConvertToReserveButton } from '@/components/finance/convert-to-reserve-button';
import { TakeBillOffPlanButton } from '@/components/finance/take-bill-off-plan-button';
import { HoldingAccountPicker } from '@/components/finance/holding-account-picker';
import { BillNameControl } from '@/components/finance/rename-bill-form';

/**
 * THE FIXED-COSTS SETTINGS CARD (C.23 / DECISIONS #431).
 *
 * This card IS the app's Fixed basis — not a second one. Every figure on it is
 * the loader's own output rendered verbatim:
 *   - the headline is `plan.fixedExpensesCents`, the same figure the dashboard
 *     and plan page use;
 *   - the basis list is `plan.fixedList`, the SAME assembled lines the plan
 *     page prints (bills, rollup rows and reserve lines, each with its own
 *     basis note — a list from two bases cannot have one explanation);
 *   - the proposals are `plan.fixedSetup`, computed by the loader with the
 *     same arrays and sets the plan consumed (one authority, by construction —
 *     a line cannot be "proposed" here while the plan counts it differently);
 *   - the reserves figure is `fixedSetup.reserveMonthlyCents`, the plan's own
 *     arithmetic (`plan.ts:933` does the same reduce over the same lines).
 *
 * WHAT THE READER DOES WITH IT (the guided half the owner asked for verbatim —
 * "there should be a settings section for this"): confirm the detected lines
 * instead of typing them, or turn a long-cadence bill into a reserve with one
 * button. The lever is offered only where the swap is exact (`inBasis` →
 * −union row + reserve at the same `monthlyRateCents` = 0; genuinely-out →
 * +rate from zero); a covered series says "already counted under <Category>"
 * instead of offering a second commitment.
 */

/** One status sentence per proposal state — the UI may not invent a verdict
 *  the union did not give, so every branch reads a field the engine set. */
function statusLine(b: SetupBillProposal, nameOfCategory: (id: string) => string | null): string {
  if (b.inBasis) {
    if (b.loanPayment) return 'Loan payment — already in your fixed costs.';
    if (b.convertibleToReserve && b.convertInput) {
      return `In your fixed costs — it comes ${RESERVE_CADENCE_WORDS[b.convertInput.cadence]}, or make it a reserve.`;
    }
    return 'Already in your fixed costs.';
  }
  if (b.refusedReason === 'covered' && b.categoryId) {
    return `Already counted under ${nameOfCategory(b.categoryId) ?? 'its category'} — its spending is part of that category's fixed average.`;
  }
  if (b.refusedReason === 'budget-priced') {
    return `Counted in your ${b.categoryId ? (nameOfCategory(b.categoryId) ?? 'category') : 'budget'} budget — not added on top of it.`;
  }
  return 'Not in your fixed costs yet — adding it grows the figure.';
}

export function FixedCostsCard({
  plan,
  nameOfCategory,
  eligibleAccounts,
  holdingAccountId,
  holdingAccountLabel,
  canWrite,
}: {
  plan: SpendingPlanWithNotes;
  nameOfCategory: (id: string) => string | null;
  eligibleAccounts: { id: string; name: string }[];
  /** The stored id (a User column — the picker preselects it); null = unnamed. */
  holdingAccountId: string | null;
  holdingAccountLabel: string | null;
  /** Demo fence — the shared demo account must not learn from writes. */
  canWrite: boolean;
}) {
  const { fixedList, fixedSetup } = plan;
  return (
    <Card data-testid="fixed-costs-card">
      <CardHeader className="pb-2">
        <CardDescription>Where your fixed-cost figure comes from — and what to do with it</CardDescription>
        <CardTitle className="text-base">Fixed costs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ── 1. THE FIGURE AND ITS BASIS —────────────────────────────── */}
        <div>
          <p className="text-sm">
            Your plan counts{' '}
            <span className="font-semibold tabular-nums" data-testid="fixed-costs-total">
              {formatCents(cents(plan.fixedExpensesCents))}
            </span>{' '}
            of fixed costs a month — the same figure everywhere in the app.
          </p>
          {fixedList.lines.length === 0 ? (
            // The note alone stands in for the list — printed once, never
            // duplicated below.
            <p className="mt-2 text-xs text-muted-foreground" data-testid="fixed-costs-basis-empty">
              {fixedList.note}
            </p>
          ) : (
            <dl className="mt-2 divide-y text-sm" data-testid="fixed-costs-basis">
              {fixedList.lines.map((l) => (
                <div key={l.key} className="flex items-center justify-between gap-3 py-2" data-testid="fixed-costs-basis-row">
                  <dt className="min-w-0 text-muted-foreground">
                    {l.kind === 'recurring-bill' && l.billKey && canWrite ? (
                      <BillNameControl billKey={l.billKey} name={l.label} labelTestId="fixed-costs-basis-label" />
                    ) : (
                      <span data-testid="fixed-costs-basis-label">{l.label}</span>
                    )}
                    {/* Same chip rules as the plan page (the L.30 shape): a
                        chip that repeats its neighbour is clutter, not
                        disclosure. */}
                    {l.kind === 'recurring-bill' &&
                    (l.loanPayment || !l.label.startsWith(UNNAMED_BILL_LABEL)) ? (
                      <span
                        className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                        data-testid="fixed-costs-basis-bill-chip"
                      >
                        {l.loanPayment ? 'loan payment' : 'repeating bill'}
                      </span>
                    ) : null}
                    {l.kind === 'reserve' ? (
                      <span
                        className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                        data-testid="fixed-costs-basis-reserve-chip"
                      >
                        reserve
                      </span>
                    ) : null}
                    {l.basisNote ? (
                      <span className="text-xs" data-testid="fixed-costs-basis-note">
                        {l.basisNote}
                      </span>
                    ) : null}
                  </dt>
                  <dd className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums" data-testid="fixed-costs-basis-amount">
                      {formatCents(cents(l.amountCents))}
                    </span>
                    {l.kind === 'recurring-bill' && l.billKey && !l.loanPayment && canWrite ? (
                      <TakeBillOffPlanButton billKey={l.billKey} billName={l.label} />
                    ) : null}
                  </dd>
                </div>
              ))}
              <div className="flex items-center justify-between py-2.5">
                <dt className="font-semibold">Total of these lines</dt>
                <dd className="text-base font-bold tabular-nums" data-testid="fixed-costs-basis-total">
                  {formatCents(cents(fixedList.totalCents))}
                </dd>
              </div>
              {/* The two figures on screen whenever they differ — the
                  arithmetic is the disclosure (the plan page's own rule). */}
              {!fixedList.reconciles && fixedList.unaccountedCents !== 0 ? (
                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-muted-foreground">Fixed costs your plan uses</dt>
                  <dd className="shrink-0 tabular-nums" data-testid="fixed-costs-basis-plan-figure">
                    {formatCents(cents(fixedList.planFixedCents))}
                  </dd>
                </div>
              ) : null}
            </dl>
          )}
          {fixedList.lines.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground" data-testid="fixed-costs-basis-note-final">
              {fixedList.note}
            </p>
          ) : null}
          <div className="mt-2">
            <Link
              href="/spending-plan"
              className="text-xs underline underline-offset-2"
              data-testid="fixed-costs-edit-link"
            >
              Adjust these on the plan page
            </Link>
          </div>
        </div>

        {/* ── 2. THE PROPOSALS — every counted expense series, with the
                lever where the swap is exact ─────────────────────────────── */}
        <div className="border-t pt-4" data-testid="fixed-proposals">
          <h3 className="mb-1 text-sm font-semibold">Repeating expenses we found</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            Detected from your own transactions — confirm what&apos;s already counted, or turn a
            long-term one into a reserve and set the cash aside yourself, a little each month.
          </p>
          {fixedSetup.bills.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="fixed-proposals-empty">
              No repeating expenses detected yet — they appear here as soon as your transactions
              show a rhythm.
            </p>
          ) : (
            <ul className="divide-y text-sm" data-testid="fixed-proposals-list">
              {fixedSetup.bills.map((b) => (
                <li
                  key={b.key}
                  className="flex items-center justify-between gap-3 py-2"
                  data-testid="fixed-proposal-row"
                  data-proposal-key={b.key}
                >
                  <div className="min-w-0">
                    <p className="text-foreground">
                      {b.convertInput?.name ?? b.merchantCanonical ?? 'A repeating expense'}
                      {b.loanPayment ? (
                        <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                          loan payment
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground" data-testid="fixed-proposal-status">
                      {statusLine(b, nameOfCategory)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums" data-testid="fixed-proposal-monthly">
                      {formatCents(cents(b.monthlyRateCents))}/mo
                    </span>
                    {b.convertibleToReserve && canWrite && b.billKey ? (
                      <ConvertToReserveButton merchantCanonical={b.billKey} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── 3. RESERVES — the figure, its named home, and the form ────── */}
        <div className="border-t pt-4" data-testid="reserves-setup">
          <h3 className="mb-1 text-sm font-semibold">Money you set aside each month</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            For costs that are real but haven&apos;t arrived yet — home repair, yearly dues, a car
            service. Tell us the whole cost and how often it comes around; we divide it and count
            the monthly share as a fixed cost.
          </p>
          {fixedSetup.reserveMonthlyCents > 0 ? (
            <p className="text-sm" data-testid="reserves-monthly-figure">
              Move{' '}
              <span className="font-semibold tabular-nums">
                {formatCents(cents(fixedSetup.reserveMonthlyCents))}
              </span>{' '}
              to reserves this month
              {holdingAccountClause(holdingAccountLabel)}.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="reserves-monthly-figure">
              Nothing is set aside to reserves yet{holdingAccountClause(holdingAccountLabel)}.
            </p>
          )}
          {/* Critic P2-5: a refused declaration is money the reader told us
              about and the figure is now spending as though it were free — the
              plan page's own disclosure rule, mirrored here with the same
              headline so this surface and that one state one thing. The remove
              control lives on the plan page (the link above); the card names
              the state and the remedy, never invents a verdict. */}
          {plan.refusedReserves.length > 0 ? (
            <div className="mt-3" data-testid="reserves-refused-card">
              <p className="text-xs text-red-500">
                {plan.refusedReserves.length === 1
                  ? "One of your reserves isn't in your fixed costs. Remove it and add it again to fix it."
                  : `${plan.refusedReserves.length} of your reserves aren't in your fixed costs. Remove them and add them again to fix them.`}
              </p>
              <dl className="mt-1 divide-y text-sm">
                {plan.refusedReserves.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 py-1.5"
                    data-testid="reserve-refused-row-card"
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
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {canWrite ? (
            <div className="mt-2 space-y-3">
              <HoldingAccountPicker
                accounts={eligibleAccounts}
                currentId={holdingAccountId}
                canWrite={canWrite}
              />
              <ReserveForm />
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="reserves-demo-note">
              The demo is a shared account, so reserves can&apos;t be added here — create your own
              free account and they&apos;ll be waiting for you.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
