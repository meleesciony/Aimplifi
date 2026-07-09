'use client';

/**
 * Transaction register filter bar. Reflects the current filter into the URL
 * query string (shareable / back-button friendly) and drives the server
 * component re-render. No client-side data; the server does the filtering via
 * the pure query engine.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { hasActiveTxnFilters, type FlowType } from '@/lib/engine/transactions/query';

function asFlowType(t: string): FlowType {
  return t === 'income' || t === 'expense' || t === 'transfer' || t === 'all' ? t : 'all';
}

const TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'transfer', label: 'Transfers' },
] as const;

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground';

export function TransactionFilters({
  accountOptions,
  categoryOptions,
  current,
}: {
  accountOptions: { id: string; name: string }[];
  /** Category dropdown options — the user's visible assignable set incl. customs
   *  (DECISIONS #111). Hidden categories are still findable via the search box. */
  categoryOptions: { id: string; name: string }[];
  current: { search: string; account: string; category: string; type: string; from: string; to: string };
}) {
  const router = useRouter();
  const [search, setSearch] = useState(current.search);

  // keep the local search box in sync if the URL changes elsewhere (e.g. Clear)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- pre-existing pattern surfaced by the react-hooks v6 upgrade (#166), not this increment's scope
  useEffect(() => setSearch(current.search), [current.search]);

  function commit(next: Partial<typeof current>) {
    const merged = { ...current, ...next };
    const q = new URLSearchParams();
    if (merged.search.trim()) q.set('q', merged.search.trim());
    if (merged.account) q.set('account', merged.account);
    if (merged.category) q.set('category', merged.category);
    if (merged.type && merged.type !== 'all') q.set('type', merged.type);
    if (merged.from) q.set('from', merged.from);
    if (merged.to) q.set('to', merged.to);
    const qs = q.toString();
    router.push(qs ? `/transactions?${qs}` : '/transactions');
  }

  const hasFilters = hasActiveTxnFilters({
    search: current.search,
    accountId: current.account || null,
    categoryId: current.category || null,
    type: asFlowType(current.type),
    from: current.from || null,
    to: current.to || null,
  });

  return (
    <div className="space-y-2" data-testid="txn-filters">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          commit({ search });
        }}
        className="flex gap-2"
      >
        <input
          type="search"
          inputMode="search"
          aria-label="Search transactions"
          placeholder="Search transactions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="txn-search"
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        />
        <button
          type="submit"
          className="h-9 shrink-0 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent"
        >
          Search
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Type"
          value={current.type}
          onChange={(e) => commit({ type: e.target.value })}
          data-testid="txn-filter-type"
          className={selectClass}
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Account"
          value={current.account}
          onChange={(e) => commit({ account: e.target.value })}
          data-testid="txn-filter-account"
          className={selectClass}
        >
          <option value="">All accounts</option>
          {accountOptions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Category"
          value={current.category}
          onChange={(e) => commit({ category: e.target.value })}
          data-testid="txn-filter-category"
          className={selectClass}
        >
          <option value="">All categories</option>
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          From
          <input
            type="date"
            aria-label="From date"
            value={current.from}
            onChange={(e) => commit({ from: e.target.value })}
            className={selectClass}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          To
          <input
            type="date"
            aria-label="To date"
            value={current.to}
            onChange={(e) => commit({ to: e.target.value })}
            className={selectClass}
          />
        </label>

        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              router.push('/transactions');
            }}
            data-testid="txn-clear"
            className="h-9 rounded-md px-2 text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
