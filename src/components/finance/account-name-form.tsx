'use client';

/**
 * Rename a card from a painted title. Overlay only — writes Account.displayName
 * via renameAccount, never Account.name. Same mutation recipe as PayeeNameControl.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { renameAccount, type RenameResult } from '@/server/account-rename-actions';
import { withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { MAX_NICKNAME_LENGTH } from '@/lib/engine/account/display-name';

const inputCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function AccountNameControl({
  accountId,
  name,
  hasOverlay,
  feedName,
}: {
  accountId: string;
  name: string;
  hasOverlay: boolean;
  feedName: string;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  const [result, setResult] = useState<RenameResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') ?? '');
    setBusy('save');
    try {
      const res = await withDeadline(renameAccount({ accountId, name }), FORM_ACTION_DEADLINE_MS);
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
      const res = await withDeadline(renameAccount({ accountId, name: '' }), FORM_ACTION_DEADLINE_MS);
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
        data-testid="card-row-name"
        aria-label={`Rename card ${name}`}
        onClick={() => setEditing(true)}
      >
        {name}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1" data-testid="card-rename-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`card-rename-${accountId}`}>
          Card name
        </label>
        <input
          id={`card-rename-${accountId}`}
          name="name"
          defaultValue={name}
          maxLength={MAX_NICKNAME_LENGTH}
          placeholder={feedName}
          className={`w-56 ${inputCls}`}
          data-testid="card-rename-input"
        />
        <Button type="submit" size="sm" disabled={busy !== null} data-testid="card-rename-save">
          {busy === 'save' ? 'Saving…' : 'Save name'}
        </Button>
        {hasOverlay ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={onClear}
            data-testid="card-rename-clear"
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
      <p className="text-xs text-muted-foreground">
        Leave the box empty to go back to {feedName}.
      </p>
      {result && !result.ok && result.errors ? (
        <p className="text-xs text-red-500" role="alert">
          {result.errors.join(' ')}
        </p>
      ) : null}
    </form>
  );
}
