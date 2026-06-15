'use client';

/**
 * Money Dials form. Posts to the updateMoneyDials server action via
 * useActionState so per-field validation errors render inline without leaving
 * the page. Inputs are pre-populated from the stored values (via the engine's
 * UI-boundary display helpers); every projection field states its assumption
 * inline per the coaching guardrails.
 */
import Link from 'next/link';
import { useActionState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  bpsToPercentInput,
  centsToDollarInput,
  type DialField,
} from '@/lib/engine/settings/dials';
import { updateMoneyDials, type DialsResult } from '@/server/settings-actions';

const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} role="alert" className="text-xs text-red-400" data-testid={id}>
      {message}
    </span>
  );
}

export function MoneyDialsForm({
  current,
  accounts,
}: {
  current: {
    hourlyWageCents: number | null;
    swrBps: number;
    expectedReturnBps: number;
    moneyDials: string[];
    paymentAccountId: string | null;
  };
  accounts: { id: string; name: string }[];
}) {
  const [result, action, pending] = useActionState<DialsResult | null, FormData>(
    updateMoneyDials,
    null,
  );
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
        <form action={action} className="space-y-4" data-testid="money-dials-form">
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

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending} data-testid="dials-submit">
              {pending ? 'Saving…' : 'Save dials'}
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
      </CardContent>
    </Card>
  );
}
