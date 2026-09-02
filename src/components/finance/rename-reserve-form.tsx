'use client';

/**
 * Rename a reserve already on the spending plan. The dollars stay put —
 * this control is a NAME, never a money figure. Same mutation recipe as
 * ReserveForm (#164/#166): onSubmit, own busy flag, deadline, full reload.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { renameReserve, type ReserveFormResult } from '@/server/reserve-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function ReserveNameControl({
  reserveId,
  name,
}: {
  reserveId: string;
  name: string;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReserveFormResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await withDeadline(renameReserve(reserveId, fd), FORM_ACTION_DEADLINE_MS);
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
        data-testid="reserve-row-name"
        aria-label={`Rename ${name}`}
        onClick={() => setEditing(true)}
      >
        {name}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="reserve-rename-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`reserve-rename-${reserveId}`}>
          Envelope name
        </label>
        <input
          id={`reserve-rename-${reserveId}`}
          name="name"
          required
          defaultValue={name}
          aria-invalid={result?.errors?.name ? true : undefined}
          aria-describedby={result?.errors?.name ? 'reserve-rename-error' : undefined}
          className={`w-44 ${inputCls}`}
          data-testid="reserve-rename-input"
        />
        <Button type="submit" size="sm" disabled={busy} data-testid="reserve-rename-save">
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
        <p id="reserve-rename-error" className="text-xs text-red-500" role="alert">
          {result.errors.name}
        </p>
      ) : null}
      {result?.error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="reserve-rename-form-error">
          {result.error}
        </p>
      ) : null}
    </form>
  );
}
