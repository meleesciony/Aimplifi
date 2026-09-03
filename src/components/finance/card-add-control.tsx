'use client';

/**
 * Add a manual CREDIT card from the Cards page.
 * Same writer as Accounts — addManualAccount — type locked to CREDIT.
 */
import { useState } from 'react';
import { addManualAccount, type ManualResult } from '@/server/networth-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { cn } from '@/lib/utils';

export function CardAddControl({
  triggerTestId = 'cards-add-open',
  triggerLabel = 'Add a card',
  idleClassName,
}: {
  triggerTestId?: string;
  triggerLabel?: string;
  idleClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ManualResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '');
    const value = String(fd.get('value') ?? '');
    setBusy(true);
    try {
      const res = await withDeadline(
        addManualAccount({ name, type: 'CREDIT', value }),
        FORM_ACTION_DEADLINE_MS,
      );
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
        className={cn(
          idleClassName ??
            'tap-target inline-flex items-center justify-center rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent',
        )}
        data-testid={triggerTestId}
        aria-label="Add a credit card"
        onClick={() => setEditing(true)}
      >
        {triggerLabel}
      </button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-2 rounded-lg border p-3 text-left"
      data-testid="cards-add-form"
    >
      <p className="text-sm font-medium">Add a card</p>
      <input
        type="text"
        name="name"
        placeholder="e.g. Travel card"
        data-testid="cards-add-name"
        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      />
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground">$</span>
        <input
          type="text"
          name="value"
          inputMode="decimal"
          placeholder="0.00"
          data-testid="cards-add-value"
          className="w-28 rounded-md border bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          data-testid="cards-add-save"
          disabled={busy}
          className="tap-target inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
        >
          Add
        </button>
        <button
          type="button"
          data-testid="cards-add-cancel"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setResult(null);
          }}
          className="tap-target inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {result && !result.ok && result.errors ? (
        <p className="text-xs text-red-500" role="alert">
          {result.errors.join(' ')}
        </p>
      ) : null}
    </form>
  );
}
