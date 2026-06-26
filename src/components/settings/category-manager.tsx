'use client';

/**
 * Settings → Categories (DECISIONS #110). Show/hide each system category from
 * the assignment pickers. Optimistic with rollback: a failed server write
 * restores the prior state and surfaces the error — a toggle is never silently
 * lost. Hiding is a per-user preference, never a delete, so anything already
 * filed under a category keeps it and still appears in reports.
 */
import { useMemo, useState, useTransition } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setCategoryHidden } from '@/server/category-actions';
import type { CatalogGroup } from '@/lib/engine/categorize/visibility';

export function CategoryManager({ catalog }: { catalog: CatalogGroup[] }) {
  const initialHidden = useMemo(
    () => new Set(catalog.flatMap((g) => g.categories.filter((c) => c.hidden).map((c) => c.id))),
    [catalog],
  );
  const [hidden, setHidden] = useState<Set<string>>(initialHidden);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string, nextHidden: boolean) {
    setError(null);
    setHidden((s) => {
      const n = new Set(s);
      if (nextHidden) n.add(id);
      else n.delete(id);
      return n;
    });
    startTransition(async () => {
      const res = await setCategoryHidden({ categoryId: id, hidden: nextHidden });
      if (!res.ok) {
        setHidden((s) => {
          const n = new Set(s);
          if (nextHidden) n.delete(id);
          else n.add(id);
          return n;
        });
        setError(res.error ?? 'Could not update — please try again.');
      }
    });
  }

  return (
    <div className="space-y-3" data-testid="category-manager">
      <p className="text-xs text-muted-foreground">
        Hidden categories disappear from the pickers when you categorize a transaction.
        Anything already filed under one keeps its category and still shows in reports.
        {hidden.size > 0 && (
          <>
            {' '}
            <span data-testid="hidden-count">{hidden.size} hidden.</span>
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
              return (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span
                    className={`text-sm ${isHidden ? 'text-muted-foreground line-through' : ''}`}
                  >
                    {c.name}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={!isHidden}
                    data-testid={`cat-visibility-${c.id}`}
                    onClick={() => toggle(c.id, !isHidden)}
                    className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {isHidden ? (
                      <>
                        <EyeOff className="size-3.5" aria-hidden /> Hidden
                      </>
                    ) : (
                      <>
                        <Eye className="size-3.5" aria-hidden /> Shown
                      </>
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
