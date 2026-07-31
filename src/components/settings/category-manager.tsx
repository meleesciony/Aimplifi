'use client';

/**
 * Settings → Built-in categories (DECISIONS #110, extended O.17). Each built-in
 * category can be RENAMED to whatever the reader calls it, and REMOVED from the
 * pickers when they don't use it.
 *
 * "Remove" is the honest word for what the hidden flag does and is deliberately
 * not called "delete": a built-in `Category` row is global and is the FK target
 * of every user's history, so it cannot be deleted, and anything already filed
 * under one keeps its category and still counts in every report. The copy says
 * exactly that, because a control labelled "Delete" that silently means "stop
 * offering this" is a claim the app does not honour. Custom categories, which
 * this user owns outright, ARE deletable — that lives in CustomCategoryManager.
 *
 * Two mutation styles on purpose. The remove/restore toggle stays optimistic
 * with rollback (#167): nothing else on this page derives from it, so the
 * inline flip is safe and a failed write restores the prior state. A RENAME
 * takes the reload path instead, because the new name has to appear in the
 * pickers, the register, reports, trends, budgets, coach and Ask — the
 * re-rendered page is the confirmation that can't lie.
 */
import { useMemo, useState } from 'react';
import { Eye, EyeOff, Pencil, Check, X, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setCategoryHidden } from '@/server/category-actions';
import { renameSystemCategory, resetSystemCategoryName } from '@/server/category-rename-actions';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import type { CatalogGroup } from '@/lib/engine/categorize/visibility';
import { MAX_CATEGORY_NAME } from '@/lib/engine/categorize/categories';

const fieldClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground';

export function CategoryManager({
  catalog,
  canRename,
}: {
  catalog: CatalogGroup[];
  /** False for the shared demo row, where a typed name would reach the next visitor. */
  canRename: boolean;
}) {
  const initialHidden = useMemo(
    () => new Set(catalog.flatMap((g) => g.categories.filter((c) => c.hidden).map((c) => c.id))),
    [catalog],
  );
  const [hidden, setHidden] = useState<Set<string>>(initialHidden);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [pending, setPending] = useState(false);

  const renamedCount = useMemo(
    () => catalog.reduce((n, g) => n + g.categories.filter((c) => c.renamed).length, 0),
    [catalog],
  );

  function toggle(id: string, nextHidden: boolean) {
    setError(null);
    setHidden((s) => {
      const n = new Set(s);
      if (nextHidden) n.add(id);
      else n.delete(id);
      return n;
    });
    const rollback = () =>
      setHidden((s) => {
        const n = new Set(s);
        if (nextHidden) n.delete(id);
        else n.add(id);
        return n;
      });
    void (async () => {
      try {
        const res = await withDeadline(
          setCategoryHidden({ categoryId: id, hidden: nextHidden }),
          FORM_ACTION_DEADLINE_MS,
        );
        if (!res.ok) {
          rollback();
          setError(res.error ?? 'Could not update — please try again.');
        }
      } catch (e) {
        if (e instanceof ActionDeadline) {
          // Confirmation stream severed — the write usually committed, but the
          // optimistic state can't be trusted either way: re-sync (#164 rule).
          window.location.reload();
          return;
        }
        rollback();
        setError('Could not update — please try again.');
      }
    })();
  }

  /** Rename/reset: deadline-bounded, reload on success (#167). */
  function runRename(fn: () => Promise<{ ok: boolean; error?: string }>, fallbackError: string) {
    if (pending) return;
    setError(null);
    setPending(true);
    void (async () => {
      try {
        const res = await withDeadline(fn(), FORM_ACTION_DEADLINE_MS);
        if (!res.ok) {
          setError(res.error ?? fallbackError);
          setPending(false);
          return;
        }
        window.location.reload(); // pending stays true until the new page
      } catch (e) {
        if (e instanceof ActionDeadline) {
          window.location.reload();
          return;
        }
        setError(fallbackError);
        setPending(false);
      }
    })();
  }

  function saveRename(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) return;
    runRename(
      () => renameSystemCategory({ categoryId: id, name: trimmed }),
      'Could not rename that category.',
    );
  }

  function resetName(id: string) {
    runRename(
      () => resetSystemCategoryName({ categoryId: id }),
      'Could not reset that name.',
    );
  }

  return (
    <div className="space-y-3" data-testid="category-manager">
      <p className="text-xs text-muted-foreground">
        {canRename
          ? 'Rename a category to whatever you call it, or remove the ones you don’t use. '
          : 'Remove the ones you don’t use. Renaming is off in the demo, which is a shared account — a name typed here would show up for other visitors. '}
        Removing takes a category out of the pickers you choose from, and nothing is deleted:
        whatever is already filed under it keeps its category and still counts in your reports.
        Aimplifi can still file a new transaction there on its own when it clearly fits — removing
        a category hides it from you, it doesn’t stop the app using it.
        {hidden.size > 0 && (
          <>
            {' '}
            <span data-testid="hidden-count">{hidden.size} removed.</span>
          </>
        )}
        {renamedCount > 0 && (
          <>
            {' '}
            <span data-testid="renamed-count">{renamedCount} renamed.</span>
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-400" data-testid="category-manager-error">
          {error}
        </p>
      )}
      {catalog.map((g) => (
        <div key={g.group}>
          <div className="px-1 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {g.group}
          </div>
          <ul className="divide-y rounded-md border">
            {g.categories.map((c) => {
              const isHidden = hidden.has(c.id);
              if (editingId === c.id) {
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveRename(c.id);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                      aria-label={`Rename ${c.name}`}
                      maxLength={MAX_CATEGORY_NAME}
                      data-testid={`cat-rename-input-${c.id}`}
                      className={`${fieldClass} min-w-0 flex-1`}
                      autoFocus
                    />
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => saveRename(c.id)}
                        disabled={pending || !editName.trim()}
                        aria-label="Save name"
                        data-testid={`cat-rename-save-${c.id}`}
                        className="h-7 px-1.5 text-xs"
                      >
                        <Check className="size-3.5" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(null)}
                        aria-label="Cancel rename"
                        className="h-7 px-1.5 text-xs text-muted-foreground"
                      >
                        <X className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </li>
                );
              }
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="min-w-0 truncate">
                    <span className={`text-sm ${isHidden ? 'text-muted-foreground line-through' : ''}`}>
                      {c.name}
                    </span>
                    {c.renamed && (
                      <span
                        className="ml-1.5 text-xs text-muted-foreground"
                        data-testid={`cat-renamed-from-${c.id}`}
                      >
                        · built in as {c.defaultName}
                      </span>
                    )}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    {canRename && c.renamed && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => resetName(c.id)}
                        disabled={pending}
                        aria-label={`Reset ${c.name} to ${c.defaultName}`}
                        data-testid={`cat-rename-reset-${c.id}`}
                        className="h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                      </Button>
                    )}
                    {canRename && c.hideable && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditName(c.name);
                          setError(null);
                        }}
                        disabled={pending}
                        aria-label={`Rename ${c.name}`}
                        data-testid={`cat-rename-${c.id}`}
                        className="h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </Button>
                    )}
                    {/* Gated on the same predicate the server enforces, so a
                        category that stops being removable loses the control
                        rather than offering one that fails. */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      // No `aria-pressed`: it described the old STATE labels
                      // ("Shown"/"Hidden"). With an ACTION label, `aria-pressed`
                      // on a visible category announces "Remove, pressed" — it
                      // tells a screen-reader user the category is already gone.
                      // The label alone carries the state now.
                      disabled={!c.hideable}
                      data-testid={`cat-visibility-${c.id}`}
                      onClick={() => toggle(c.id, !isHidden)}
                      className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {isHidden ? (
                        <>
                          <Eye className="size-3.5" aria-hidden /> Restore
                        </>
                      ) : (
                        <>
                          <EyeOff className="size-3.5" aria-hidden /> Remove
                        </>
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
