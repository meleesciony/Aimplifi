'use client';

/**
 * Manual transaction entry form. Direction (out/in) and an optional explicit
 * category; leaving the category on "Auto-detect" runs the categorization
 * pipeline server-side.
 *
 * Deliberately NOT useActionState/form-action (see GoalForm, #166/#170): React
 * 19 auto-resets a form-action form after every dispatch, which — on the very
 * validation failure this inline-error flow exists to soothe — wiped the typed
 * amount/description and snapped the account <select> back to the first option,
 * silently re-filing the retry to the WRONG account (hostile-critic P1). Instead
 * an explicit onSubmit calls the action directly with an own busy flag and a
 * deadline-bounded await; a failure leaves the uncontrolled inputs untouched
 * (nothing to restore), and success is a full navigation to the register (which
 * therefore can't show stale state).
 */
import { useState } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { type AddTxnResult, createManualTransaction } from '@/server/transaction-actions';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';

export function AddTransactionForm({
  accounts,
  categoryOptions,
  defaultDate,
}: {
  accounts: { id: string; name: string }[];
  /** Assignable categories incl. the user's customs (DECISIONS #111). */
  categoryOptions: { id: string; name: string }[];
  defaultDate: string;
}) {
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AddTxnResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(createManualTransaction(null, fd), FORM_ACTION_DEADLINE_MS);
      setResult(res);
      if (res.ok) {
        // Full navigation, not router.refresh() — the re-rendered register is the
        // confirmation that can't lie. busy stays true so the button holds.
        window.location.assign('/transactions');
        return;
      }
      setBusy(false);
    } catch (e) {
      if (e instanceof ActionDeadline) {
        // Deadline: the create usually COMMITTED and only the confirmation was
        // lost — re-sync by landing on the register rather than report a false
        // failure (#164 recovery rule).
        window.location.assign('/transactions');
        return;
      }
      // A genuine (non-deadline) failure saved nothing — surface it and stay put,
      // don't navigate away as if it worked (#170 critic P2, tighter than GoalForm).
      setResult({ ok: false, errors: ['Something went wrong — please try again.'] });
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <form onSubmit={onSubmit} className="space-y-4" data-testid="add-txn-form">
          <input type="hidden" name="direction" value={direction} />
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Direction">
            <button
              type="button"
              aria-pressed={direction === 'out'}
              onClick={() => setDirection('out')}
              data-testid="dir-out"
              className={`h-9 rounded-md border text-sm ${
                direction === 'out' ? 'border-foreground bg-accent font-medium' : 'border-input'
              }`}
            >
              Money out
            </button>
            <button
              type="button"
              aria-pressed={direction === 'in'}
              onClick={() => setDirection('in')}
              data-testid="dir-in"
              className={`h-9 rounded-md border text-sm ${
                direction === 'in' ? 'border-foreground bg-accent font-medium' : 'border-input'
              }`}
            >
              Money in
            </button>
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Description</span>
            <input
              name="descriptor"
              required
              placeholder="e.g. Farmers market, check #142"
              data-testid="txn-descriptor"
              className={fieldClass}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Amount</span>
              <input
                name="amount"
                required
                inputMode="decimal"
                placeholder="0.00"
                data-testid="txn-amount"
                className={fieldClass}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Date</span>
              <input
                type="date"
                name="date"
                required
                defaultValue={defaultDate}
                data-testid="txn-date"
                className={fieldClass}
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Account</span>
            <select name="accountId" required data-testid="txn-account" className={fieldClass}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Category</span>
            <select name="categoryId" data-testid="txn-category" className={fieldClass}>
              <option value="">Auto-detect</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              Leave on Auto-detect to let Aimplifi categorize it (ambiguous ones go
              to your Inbox).
            </span>
          </label>

          <p className="text-xs text-muted-foreground">
            This records activity for tracking and categories. It doesn&apos;t
            change an account&apos;s reported balance.
          </p>

          {result && !result.ok && result.errors && result.errors.length > 0 && (
            <p
              role="alert"
              data-testid="add-txn-error"
              className="rounded-md border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300"
            >
              {result.errors.join(' ')}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={busy} data-testid="txn-submit">
              {busy ? 'Adding…' : 'Add transaction'}
            </Button>
            <Link href="/transactions" className={buttonVariants({ variant: 'ghost' })}>
              Cancel
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
