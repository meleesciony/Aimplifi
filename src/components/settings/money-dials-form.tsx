'use client';

/**
 * Money Dials form. Calls the updateMoneyDials server action directly so
 * per-field validation errors render inline without leaving the page (#166 —
 * see the onSubmit comment for why not useActionState). Inputs are pre-populated from the stored values (via the engine's
 * UI-boundary display helpers); every projection field states its assumption
 * inline per the coaching guardrails.
 */
import Link from 'next/link';
import { useState } from 'react';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { CheckCircle2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ageToInput,
  bpsToPercentInput,
  centsToDollarInput,
  DEFAULT_EXPECTED_RETURN_BPS,
  returnIsAppDefault,
  type DialField,
} from '@/lib/engine/settings/dials';
import { updateMoneyDials, type DialsResult } from '@/server/settings-actions';

const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} role="alert" className="block text-xs text-red-400" data-testid={id}>
      {message}
    </span>
  );
}

export function MoneyDialsForm({
  current,
  accounts,
  canWrite = true,
}: {
  current: {
    hourlyWageCents: number | null;
    swrBps: number;
    expectedReturnBps: number;
    moneyDials: string[];
    paymentAccountId: string | null;
    currentAge: number | null;
    retirementAge: number | null;
    endAge: number | null;
    inflationBps: number | null;
    savingsTargetBps: number | null;
  };
  accounts: { id: string; name: string }[];
  /** False on the shared demo: a visitor's dials must never re-derive the
   *  coaching figures the NEXT visitor sees (same shape as FixedCostsCard's
   *  canWrite). The values stay readable via the coach cards that print them. */
  canWrite?: boolean;
}) {
  // #166: direct invocation + own busy flag + deadline — NOT useActionState
  // (whose result/pending application was a coin-flip in probes: the
  // "dials-saved" confirmation could simply never arrive while the save had
  // committed). Unlike the budgets/goals forms, NO reload on success: nothing
  // else on this page derives from the dials, and the result here is plain
  // awaited state — deterministic on its own. Only a severed confirmation
  // (deadline) reloads to show the truth.
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DialsResult | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateMoneyDials(null, fd), FORM_ACTION_DEADLINE_MS);
      setResult(res);
    } catch {
      // Deadline: the save usually COMMITTED — the reload shows the truth.
      window.location.reload();
      return;
    } finally {
      setBusy(false);
    }
  }
  const err = (f: DialField) => result?.errors?.[f];
  const describedBy = (f: DialField, hintId: string) =>
    err(f) ? `dials-error-${f} ${hintId}` : hintId;

  return (
    <Card data-testid="money-dials-card">
      <CardHeader className="pb-2">
        <CardDescription>Personalize the answers</CardDescription>
        <CardTitle className="text-base">Money dials</CardTitle>
      </CardHeader>
      <CardContent>
        {!canWrite && (
          <p className="text-sm text-muted-foreground" data-testid="dials-demo-note">
            The demo is a shared account, so your planning dials can&rsquo;t be changed here —
            create your own free account and they&rsquo;ll be waiting for you.
          </p>
        )}
        {canWrite ? (
        <form onSubmit={onSubmit} className="space-y-4" data-testid="money-dials-form">
          {/* payment account — the input the whole cash-needed answer is built on */}
          {accounts.length === 0 ? (
            <div
              className="rounded-md border border-input bg-background p-3 text-sm"
              data-testid="dials-no-accounts"
            >
              <p className="font-medium">No checking or savings account yet</p>
              <p className="mt-1 text-muted-foreground">
                Card payments are drawn from a checking or savings account. Add one first,
                then come back to choose it here.
              </p>
              <Link
                href="/accounts"
                className={`mt-2 inline-flex ${buttonVariants({ variant: 'outline', size: 'sm' })}`}
              >
                Go to accounts
              </Link>
            </div>
          ) : (
            <label className="block space-y-1">
              <span className="text-sm font-medium">Card payments come from</span>
              <select
                name="paymentAccountId"
                defaultValue={current.paymentAccountId ?? ''}
                required
                data-testid="dials-payment-account"
                aria-invalid={err('paymentAccountId') ? true : undefined}
                aria-describedby={describedBy('paymentAccountId', 'dials-hint-account')}
                className={fieldClass}
              >
                <option value="" disabled>
                  Choose an account…
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <span id="dials-hint-account" className="text-xs text-muted-foreground">
                The checking or savings account your card payments are drawn from. This is
                the balance &ldquo;how much do I need&rdquo; is measured against.
              </span>
              <FieldError id="dials-error-paymentAccountId" message={err('paymentAccountId')} />
            </label>
          )}

          {/* safe withdrawal rate */}
          <label className="block space-y-1">
            <span className="text-sm font-medium">Safe withdrawal rate (%)</span>
            <input
              name="swr"
              inputMode="decimal"
              autoComplete="off"
              required
              defaultValue={bpsToPercentInput(current.swrBps)}
              data-testid="dials-swr"
              aria-invalid={err('swr') ? true : undefined}
              aria-describedby={describedBy('swr', 'dials-hint-swr')}
              className={fieldClass}
            />
            <span id="dials-hint-swr" className="text-xs text-muted-foreground">
              The share of your portfolio you plan to spend per year in retirement. Your FI
              number is your annual spending ÷ this rate (4% ≈ 25× your yearly spending). A
              common planning assumption, not a guarantee.
            </span>
            <FieldError id="dials-error-swr" message={err('swr')} />
          </label>

          {/* expected return */}
          <label className="block space-y-1">
            <span className="text-sm font-medium">Expected annual return (%)</span>
            <input
              name="expectedReturn"
              inputMode="decimal"
              autoComplete="off"
              required
              defaultValue={bpsToPercentInput(current.expectedReturnBps)}
              data-testid="dials-return"
              aria-invalid={err('expectedReturn') ? true : undefined}
              aria-describedby={describedBy('expectedReturn', 'dials-hint-return')}
              className={fieldClass}
            />
            <span id="dials-hint-return" className="text-xs text-muted-foreground">
              The long-run return assumed when projecting how your savings grow and what a
              recurring expense could be worth invested. Markets are not guaranteed; this is
              an assumption you can change.
              {/* W.13 — the retirement fieldset below says "leave any blank to use our
                  defaults" and this field cannot: it is required and arrives pre-filled, so
                  the number sitting in the box reads as one the reader chose. /coach now calls
                  the same rate "our default 7.00% return assumption", and the page it links to
                  had better say the same thing. Value-equality, so a reader who typed exactly
                  7 also sees it — the sentence claims only that 7% IS our default, never that
                  they have not changed it. */}
              {returnIsAppDefault(current.expectedReturnBps) ? (
                <> The {bpsToPercentInput(DEFAULT_EXPECTED_RETURN_BPS)}% here is our default.</>
              ) : null}
            </span>
            <FieldError id="dials-error-expectedReturn" message={err('expectedReturn')} />
          </label>

          {/* hourly wage (optional) */}
          <label className="block space-y-1">
            <span className="text-sm font-medium">After-tax hourly wage ($, optional)</span>
            <input
              name="wage"
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 38"
              defaultValue={current.hourlyWageCents != null ? centsToDollarInput(current.hourlyWageCents) : ''}
              data-testid="dials-wage"
              aria-invalid={err('wage') ? true : undefined}
              aria-describedby={describedBy('wage', 'dials-hint-wage')}
              className={fieldClass}
            />
            <span id="dials-hint-wage" className="text-xs text-muted-foreground">
              Your effective take-home pay per hour. Powers the &ldquo;hours of work&rdquo;
              view that translates a purchase into time. Leave blank to hide it.
            </span>
            <FieldError id="dials-error-wage" message={err('wage')} />
          </label>

          {/* money dials */}
          <label className="block space-y-1">
            <span className="text-sm font-medium">Your money dials (optional)</span>
            <textarea
              name="moneyDials"
              rows={3}
              defaultValue={current.moneyDials.join(', ')}
              placeholder={'Travel, Dining Out, Hobbies'}
              data-testid="dials-money-dials"
              aria-invalid={err('moneyDials') ? true : undefined}
              aria-describedby={describedBy('moneyDials', 'dials-hint-dials')}
              className={`py-2 ${fieldClass} h-auto`}
            />
            <span id="dials-hint-dials" className="text-xs text-muted-foreground">
              The few things you spend on intentionally and without guilt — separated by
              commas or new lines. Up to 12, used to frame your spending, never to judge it.
            </span>
            <FieldError id="dials-error-moneyDials" message={err('moneyDials')} />
          </label>

          {/* savings target — the guilt-free-spending allocation (#295 / L.11C) */}
          <label className="block space-y-1">
            <span className="text-sm font-medium">Savings target (% of income, optional)</span>
            <input
              name="savingsTarget"
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 15"
              defaultValue={current.savingsTargetBps != null ? bpsToPercentInput(current.savingsTargetBps) : ''}
              data-testid="dials-savings-target"
              aria-invalid={err('savingsTarget') ? true : undefined}
              aria-describedby={describedBy('savingsTarget', 'dials-hint-savings-target')}
              className={fieldClass}
            />
            <span id="dials-hint-savings-target" className="text-xs text-muted-foreground">
              Pay yourself first: this share of your monthly income pattern is set aside
              before guilt-free spending is counted. We count the larger of this and your
              goal contributions — never both. Leave blank to use your goals alone.
            </span>
            <FieldError id="dials-error-savingsTarget" message={err('savingsTarget')} />
          </label>

          {/* ── retirement plan (optional; blank = our default assumption) ── */}
          <fieldset className="space-y-2 rounded-md border border-input p-3">
            <legend className="px-1 text-sm font-medium">Retirement plan (optional)</legend>
            <p className="text-xs text-muted-foreground">
              The ages the retirement outlook on{' '}
              <Link href="/investments" className="underline hover:text-foreground">
                Investments
              </Link>{' '}
              projects with. The inflation figure reaches further: since it is subtracted from
              your expected return to give growth in today&apos;s money, it also moves your FI
              date, the Coast line and the wealth target on{' '}
              <Link href="/coach" className="underline hover:text-foreground">
                Coach
              </Link>
              , and every goal&apos;s effect on that date. Leave any blank to use our defaults —
              age 40 today, retiring at 65, planning through 95, with 2.5% inflation.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium">Age now</span>
                <input
                  name="currentAge"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="40"
                  defaultValue={ageToInput(current.currentAge)}
                  data-testid="dials-current-age"
                  aria-invalid={err('currentAge') ? true : undefined}
                  aria-describedby={describedBy('currentAge', 'dials-hint-retirement')}
                  className={fieldClass}
                />
                <FieldError id="dials-error-currentAge" message={err('currentAge')} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">Retire at</span>
                <input
                  name="retirementAge"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="65"
                  defaultValue={ageToInput(current.retirementAge)}
                  data-testid="dials-retirement-age"
                  aria-invalid={err('retirementAge') ? true : undefined}
                  aria-describedby={describedBy('retirementAge', 'dials-hint-retirement')}
                  className={fieldClass}
                />
                <FieldError id="dials-error-retirementAge" message={err('retirementAge')} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">Plan to</span>
                <input
                  name="endAge"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="95"
                  defaultValue={ageToInput(current.endAge)}
                  data-testid="dials-end-age"
                  aria-invalid={err('endAge') ? true : undefined}
                  aria-describedby={describedBy('endAge', 'dials-hint-retirement')}
                  className={fieldClass}
                />
                <FieldError id="dials-error-endAge" message={err('endAge')} />
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Inflation (%)</span>
              <input
                name="inflation"
                inputMode="decimal"
                autoComplete="off"
                placeholder="2.5"
                defaultValue={current.inflationBps != null ? bpsToPercentInput(current.inflationBps) : ''}
                data-testid="dials-inflation"
                aria-invalid={err('inflation') ? true : undefined}
                aria-describedby={describedBy('inflation', 'dials-hint-retirement')}
                className={fieldClass}
              />
              <FieldError id="dials-error-inflation" message={err('inflation')} />
            </label>
            <span id="dials-hint-retirement" className="text-xs text-muted-foreground">
              Projections are stated in today&rsquo;s dollars: your expected return less this
              inflation rate. These are planning assumptions, not predictions.
            </span>
          </fieldset>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy} data-testid="dials-submit">
              {busy ? 'Saving…' : 'Save dials'}
            </Button>
            {/* persistent live region so the success is announced (WCAG SC 4.1.3);
                the dials-saved node stays conditional for the e2e count assertions */}
            <span role="status" aria-live="polite" className="text-sm text-emerald-500">
              {result?.ok && (
                <span className="flex items-center gap-1" data-testid="dials-saved">
                  <CheckCircle2 className="size-4" aria-hidden />
                  Money dials saved
                </span>
              )}
            </span>
          </div>
        </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
