'use client';

/**
 * Settings → Your categories (DECISIONS #111). Create your own categories,
 * rename them, or delete them. Each mutation calls a real, ownership-scoped
 * server action; on success the local list updates immediately and the route is
 * refreshed so every picker reflects the change. Deleting re-files that
 * category's transactions as Uncategorized (explained inline before you confirm).
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  createCustomCategory,
  renameCustomCategory,
  deleteCustomCategory,
} from '@/server/custom-category-actions';

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
  const router = useRouter();
  const [items, setItems] = useState<CustomCategory[]>(categories);
  const [name, setName] = useState('');
  const [group, setGroup] = useState(groups[0] ?? '');
  const [discretionary, setDiscretionary] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add() {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await createCustomCategory({ name: trimmed, group, discretionary });
      if (!res.ok || !res.id) {
        setError(res.error ?? 'Could not create that category.');
        return;
      }
      setItems((xs) => [...xs, { id: res.id!, name: trimmed, group, discretionary }]);
      setName('');
      router.refresh();
    });
  }

  function saveRename(id: string) {
    const trimmed = editName.trim();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await renameCustomCategory({ id, name: trimmed });
      if (!res.ok) {
        setError(res.error ?? 'Could not rename that category.');
        return;
      }
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, name: trimmed } : x)));
      setEditingId(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCustomCategory({ id });
      if (!res.ok) {
        setError(res.error ?? 'Could not delete that category.');
        return;
      }
      setItems((xs) => xs.filter((x) => x.id !== id));
      setConfirmId(null);
      router.refresh();
    });
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
                  {confirmId === c.id ? (
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
                        onClick={() => setConfirmId(null)}
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
                          setConfirmId(c.id);
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
