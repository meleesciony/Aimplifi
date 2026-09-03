'use client';

/**
 * Rename a payee from a transaction. Overlay only — no filing rule.
 * Same mutation recipe as GoalNameControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { clearPayeeRename, renamePayee, type PayeeRenameResult } from '@/server/payee-rename-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function PayeeNameControl({
  transactionId,
  name,
  hasOverlay,
}: {
  transactionId: string;
  name: string;
  hasOverlay: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  const [result, setResult] = useState<PayeeRenameResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy('save');
    try {
      const res = await withDeadline(renamePayee(transactionId, fd), FORM_ACTION_DEADLINE_MS);
      setResult(res);
      if (res.ok) {
        window.location.reload();
        return;
      }
    } catch {
      window.location.reload();
      return;
    } finally {
      setBusy(null);
    }
  }

  async function onClear() {
    setBusy('clear');
    try {
      const res = await withDeadline(clearPayeeRename(transactionId), FORM_ACTION_DEADLINE_MS);
      setResult(res);
      if (res.ok) {
        window.location.reload();
        return;
      }
    } catch {
      window.location.reload();
      return;
    } finally {
      setBusy(null);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="text-left underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
        data-testid="payee-row-name"
        aria-label={`Rename payee ${name}`}
        onClick={() => setEditing(true)}
      >
        {name}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="payee-rename-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`payee-rename-${transactionId}`}>
          Payee name
        </label>
        <input
          id={`payee-rename-${transactionId}`}
          name="name"
          required
          defaultValue={name}
          aria-invalid={result?.errors?.name ? true : undefined}
          aria-describedby={result?.errors?.name ? 'payee-rename-error' : undefined}
          className={`w-56 ${inputCls}`}
          data-testid="payee-rename-input"
        />
        <Button type="submit" size="sm" disabled={busy !== null} data-testid="payee-rename-save">
          {busy === 'save' ? 'Saving…' : 'Save name'}
        </Button>
        {hasOverlay ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={onClear}
            data-testid="payee-rename-clear"
          >
            {busy === 'clear' ? 'Clearing…' : 'Clear name'}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
      {result?.errors?.name ? (
        <p id="payee-rename-error" className="text-xs text-red-500" role="alert">
          {result.errors.name}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="payee-rename-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
