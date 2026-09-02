'use client';

/**
 * Name a repeating bill already on the spending plan. Dollars stay put —
 * this control is a NAME. Same mutation recipe as ReserveNameControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { renameBill, type BillRenameResult } from '@/server/bill-rename-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { UNNAMED_BILL_LABEL } from '@/lib/engine/spending-plan/bill-rename';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function BillNameControl({
  billKey,
  name,
  labelTestId = 'fixed-composition-label',
}: {
  billKey: string;
  name: string;
  labelTestId?: string;
}) {
  const inputId = `bill-rename-${billKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BillRenameResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(renameBill(billKey, fd), FORM_ACTION_DEADLINE_MS);
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
        className="text-left text-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 hover:decoration-foreground"
        data-testid={labelTestId}
        aria-label={`Rename ${name}`}
        onClick={() => setEditing(true)}
      >
        {name}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="bill-rename-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={inputId}>
          Bill name
        </label>
        <input
          id={inputId}
          name="name"
          required
          defaultValue={name.startsWith(UNNAMED_BILL_LABEL) ? '' : name}
          placeholder="Internet"
          aria-invalid={result?.errors?.name ? true : undefined}
          aria-describedby={result?.errors?.name ? 'bill-rename-error' : undefined}
          className={`w-44 ${inputCls}`}
          data-testid="bill-rename-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="bill-rename-save">
          {busy ? 'Saving…' : 'Save name'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
      {result?.errors?.name ? (
        <p id="bill-rename-error" className="text-xs text-red-500" role="alert">
          {result.errors.name}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="bill-rename-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
