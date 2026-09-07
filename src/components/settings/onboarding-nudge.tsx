'use client';

/**
 * One-time onboarding nudge: shown on the dashboard until the user has confirmed
 * which account funds their card payments (the single input the cash-needed
 * answer is built on) — Step 3 of the guided first-run flow (Competitive-Gap
 * Gap 3 §3). Gated by needsOnboarding() in the dashboard; dormant for the seeded
 * demo user. Rendered BELOW the cash-needed card so it never displaces the
 * above-the-fold answer.
 *
 * DECISIONS #690: confirm the payment account here via updatePaymentAccount —
 * same User.paymentAccountId dial as MoneyDialsForm — so Step 3 does not leave
 * for Settings. A secondary link still reaches Coach dials for the rest.
 */
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StepIndicator } from '@/components/onboarding/step-indicator';
import { TrackedActedLink } from '@/components/engagement/tracked-acted-link';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { updatePaymentAccount } from '@/server/settings-actions';

const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';

export function OnboardingNudge({
  accounts,
  currentPaymentAccountId = null,
}: {
  accounts: { id: string; name: string }[];
  currentPaymentAccountId?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await withDeadline(updatePaymentAccount(fd), FORM_ACTION_DEADLINE_MS);
      if (!res.ok) {
        setError(res.errors?.paymentAccountId ?? res.error ?? 'Could not save that account.');
        return;
      }
      window.location.reload();
    } catch {
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="onboarding-nudge" className="border-brand-500/40">
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="space-y-1">
          <StepIndicator step={3} />
          <p className="text-sm font-medium">Make this yours in 30 seconds</p>
          <p className="text-sm text-muted-foreground">
            Tell Aimplifi which account pays your cards so the amount above is measured against
            your real balance — and set your money dials to personalize your coaching.
          </p>
        </div>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a checking or savings account first, then pick it here.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-2" data-testid="onboarding-payment-form">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Card payments come from</span>
              <select
                name="paymentAccountId"
                required
                defaultValue={currentPaymentAccountId ?? ''}
                data-testid="onboarding-payment-account"
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
            </label>
            {error ? (
              <p className="text-xs text-red-500" role="alert" data-testid="onboarding-payment-error">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={busy} data-testid="onboarding-nudge-cta">
                {busy ? 'Saving…' : 'Confirm'}
              </Button>
              <TrackedActedLink
                href="/coach#coach-money-dials"
                subjectKey="onboarding-nudge"
                className={buttonVariants({ size: 'sm', variant: 'outline' })}
                data-testid="onboarding-nudge-dials"
              >
                Money dials
              </TrackedActedLink>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
