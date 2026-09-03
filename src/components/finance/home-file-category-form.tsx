'use client';

/**
 * File a category from a Home recent charge that still needs one.
 * Same mutation recipe as PayeeNameControl. One applyCategory call; this row only.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { applyCategory } from '@/server/triage-actions';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { expandSimplifiAliasRows } from '@/lib/engine/categorize/simplifi-aliases';

const selectCls = 'rounded-md border bg-background px-2 py-1.5 text-sm text-foreground';

export function HomeFileCategoryControl({
  transactionId,
  categoryGroups,
}: {
  transactionId: string;
  categoryGroups: { group: string; categories: { id: string; name: string }[] }[];
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    const categoryId = fd.get('categoryId');
    if (typeof categoryId !== 'string' || categoryId === '') return;
    setBusy(true);
    setError(null);
    try {
      await withDeadline(applyCategory({ transactionId, categoryId }), FORM_ACTION_DEADLINE_MS);
      window.location.reload();
    } catch (err) {
      if (err instanceof ActionDeadline) {
        window.location.reload();
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="shrink-0 text-left text-xs font-medium text-warning-700 underline decoration-warning-700/50 decoration-dotted underline-offset-4 hover:decoration-foreground dark:text-warning-400"
        data-testid="home-file-category-trigger"
        aria-label="File a category for this charge"
        onClick={() => setEditing(true)}
      >
        Needs category
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="min-w-0 space-y-1" data-testid="home-file-category-form">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`home-file-category-${transactionId}`}>
          Category
        </label>
        <select
          id={`home-file-category-${transactionId}`}
          name="categoryId"
          required
          className={`max-w-48 ${selectCls}`}
          data-testid="home-file-category-select"
        >
          <option value="">Choose a category…</option>
          {categoryGroups.map((g) => {
            const cats = expandSimplifiAliasRows(g.categories).filter((c) => c.id !== 'uncategorized');
            if (cats.length === 0) return null;
            return (
              <optgroup key={g.group} label={g.group}>
                {cats.map((c) => (
                  <option key={`${c.id}:${c.name}`} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <Button type="submit" size="sm" disabled={busy} data-testid="home-file-category-save">
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-red-500" role="alert" data-testid="home-file-category-form-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
