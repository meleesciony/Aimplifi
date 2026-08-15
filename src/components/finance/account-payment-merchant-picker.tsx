'use client';

/**
 * H.9 — the reader names the payee. Plain onSubmit (mutation-form-recipe):
 * a form-action reset would snap the select back to the first payee on a
 * refused submit and a retry would file the wrong history under a real debt.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { setAccountPaymentMerchant } from '@/server/account-payment-merchant-actions';

export function AccountPaymentMerchantPicker({
  accountId,
  currentCanonical,
  candidates,
}: {
  accountId: string;
  currentCanonical: string | null;
  candidates: { id: string | null; canonical: string }[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(payee: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await withDeadline(
        setAccountPaymentMerchant({ accountId, payee }),
        FORM_ACTION_DEADLINE_MS,
      );
      if (res.ok) {
        window.location.reload();
        return;
      }
      setError(res.errors?.[0] ?? 'Could not save that payee.');
    } catch {
      window.location.reload();
      return;
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payee = String(fd.get('payee') ?? '').trim();
    await run(payee === '' ? null : payee);
  }

  if (candidates.length === 0 && currentCanonical === null) {
    return null;
  }

  return (
    <div className="space-y-1" data-testid="account-detail-payment-picker">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Payee in activity
          <select
            name="payee"
            data-testid="account-detail-payment-select"
            defaultValue={currentCanonical ?? ''}
            disabled={busy}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            <option value="">Choose the payee…</option>
            {candidates.map((c) => (
              <option key={c.canonical} value={c.canonical}>
                {c.canonical}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" disabled={busy} data-testid="account-detail-payment-save">
          {busy ? 'Saving…' : currentCanonical ? 'Update' : 'Save'}
        </Button>
        {currentCanonical !== null && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            data-testid="account-detail-payment-clear"
            onClick={() => run(null)}
          >
            Clear
          </Button>
        )}
      </form>
      {error && (
        <p className="text-xs text-red-500" role="alert" data-testid="account-detail-payment-error">
          {error}
        </p>
      )}
    </div>
  );
}
