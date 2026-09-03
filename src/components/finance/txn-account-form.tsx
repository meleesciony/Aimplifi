'use client';

/**
 * Change which account a transaction sits on. Splits are not offered this
 * control. Same mutation recipe as TxnAmountControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  updateTransactionAccount,
  type TxnAccountResult,
} from '@/server/transaction-account-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function TxnAccountControl({
  transactionId,
  accountId,
  accountName,
  accounts,
  triggerTestId = 'detail-account',
}: {
  transactionId: string;
  accountId: string;
  accountName: string;
  accounts: readonly { id: string; name: string }[];
  triggerTestId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TxnAccountResult | null>(null);
  const options = accounts.some((a) => a.id === accountId)
    ? accounts
    : [{ id: accountId, name: accountName }, ...accounts];

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(updateTransactionAccount(transactionId, fd), FORM_ACTION_DEADLINE_MS);
      setResult(res);
      if (res.ok) {
        window.location.reload();
        return;
      }
    } catch {
      window.location.reload();
      return;
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="text-left underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
        data-testid={triggerTestId}
        aria-label={`Change account ${accountName}`}
        onClick={() => setEditing(true)}
      >
        {accountName}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="txn-account-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`txn-account-${transactionId}`}>
          Account
        </label>
        <select
          id={`txn-account-${transactionId}`}
          name="accountId"
          required
          defaultValue={accountId}
          aria-invalid={result?.errors?.accountId ? true : undefined}
          aria-describedby={result?.errors?.accountId ? 'txn-account-error' : undefined}
          className={inputCls}
          data-testid="txn-account-select"
        >
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={busy} data-testid="txn-account-save">
          {busy ? 'Saving…' : 'Save account'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {result?.errors?.accountId ? (
        <p id="txn-account-error" className="text-xs text-red-500" role="alert">
          {result.errors.accountId}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="txn-account-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
