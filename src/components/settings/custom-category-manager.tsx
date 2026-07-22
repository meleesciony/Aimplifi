'use client';

/**
 * Settings → Your categories (DECISIONS #111). Create your own categories,
 * rename them, or delete them. Each mutation calls a real, ownership-scoped
 * server action. Deleting re-files that category's transactions as
 * Uncategorized (explained inline before you confirm).
 *
 * Reliable-mutation recipe (#167, the #164/#166 pattern): plain pending state,
 * deadline-bounded await, full reload on success — the re-rendered list (and
 * every picker fed by it) is the confirmation that can't lie. The previous
 * optimistic local list + router.refresh() pair is gone: refresh's application
 * was a coin-flip at human pacing, so the pickers could silently stay stale.
 */
import { useState } from 'react';
import { useConfirmArm } from '@/components/ui/confirm-action';
import { Pencil, Plus, Trash2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  createCustomCategory,
  renameCustomCategory,
  deleteCustomCategory,
} from '@/server/custom-category-actions';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';

export interface CustomCategory {
  id: string;
  name: string;
  group: string;
  discretionary: boolean;
}

const fieldClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground';

export function CustomCategoryManager({
  categories,
  groups,
}: {
  categories: CustomCategory[];
  groups: string[];
}) {
  const items = categories; // server truth; every success path reloads
  const [name, setName] = useState('');
  const [group, setGroup] = useState(groups[0] ?? '');
  const [discretionary, setDiscretionary] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const confirm = useConfirmArm();
  const [pending, setPending] = useState(false);

  /** Shared #167 wrapper: deadline-bounded action → reload on success, inline
   *  error otherwise. A severed confirmation stream (deadline) re-syncs via
   *  reload too — the write usually committed (#164 recovery rule). */
  function runMutation(fn: () => Promise<{ ok: boolean; error?: string }>, fallbackError: string) {
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

  function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    runMutation(
      () => createCustomCategory({ name: trimmed, group, discretionary }),
      'Could not create that category.',
    );
  }

  function saveRename(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) return;
    runMutation(() => renameCustomCategory({ id, name: trimmed }), 'Could not rename that category.');
  }

  function remove(id: string) {
    runMutation(() => deleteCustomCategory({ id }), 'Could not delete that category.');
  }

  return (
    <div className="space-y-3" data-testid="custom-category-manager">
      <p className="text-xs text-muted-foreground">
        Create categories that fit your life — they appear in every picker, in reports, and in
        Ask. Deleting one re-files its transactions as Uncategorized; nothing is lost.
      </p>

      {error && (
        <p role="alert" className="text-xs text-red-400" data-testid="custom-category-error">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="e.g. Golf"
            aria-label="New category name"
            data-testid="custom-category-name"
            className={`${fieldClass} w-40`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Group
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            aria-label="Group"
            data-testid="custom-category-group"
            className={`${fieldClass} w-44`}
          >
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={discretionary}
            onChange={(e) => setDiscretionary(e.target.checked)}
            data-testid="custom-category-discretionary"
          />
          Discretionary
        </label>
        <Button
          type="button"
          size="sm"
          onClick={add}
          disabled={pending || !name.trim()}
          data-testid="custom-category-add"
          className="mb-0.5 gap-1"
        >
          <Plus className="size-3.5" aria-hidden /> Add
        </Button>
      </div>

      {items.length > 0 && (
        <ul className="divide-y rounded-md border" data-testid="custom-category-list">
          {items.map((c) => (
            <li
              key={c.id}
              data-testid={`custom-category-${c.id}`}
              className="flex items-center justify-between gap-3 px-3 py-1.5"
            >
              {editingId === c.id ? (
                <>
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
                    data-testid={`custom-category-edit-${c.id}`}
                    className={`${fieldClass} flex-1`}
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
                      data-testid={`custom-category-save-${c.id}`}
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
                </>
              ) : (
                <>
                  <span className="min-w-0 truncate text-sm">
                    {c.name}
                    <span className="ml-1.5 text-xs text-muted-foreground">· {c.group}</span>
                  </span>
                  {confirm.isArmed(c.id) ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Re-file as Uncategorized?</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(c.id)}
                        disabled={pending}
                        aria-label={`Confirm delete ${c.name}`}
                        data-testid={`custom-category-confirm-delete-${c.id}`}
                        className="h-7 gap-1 px-1.5 text-xs text-red-500 hover:text-red-400"
                      >
                        <Trash2 className="size-3.5" aria-hidden /> Delete
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={confirm.disarm}
                        aria-label="Cancel delete"
                        className="h-7 px-1.5 text-xs text-muted-foreground"
                      >
                        Keep
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingId(c.id);
                          setEditName(c.name);
                          setError(null);
                        }}
                        aria-label={`Rename ${c.name}`}
                        data-testid={`custom-category-rename-${c.id}`}
                        className="h-7 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          confirm.arm(c.id);
                          setError(null);
                        }}
                        disabled={pending}
                        aria-label={`Delete ${c.name}`}
                        data-testid={`custom-category-delete-${c.id}`}
                        className="h-7 gap-1 px-1.5 text-xs text-muted-foreground hover:text-red-400"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
