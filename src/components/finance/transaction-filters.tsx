'use client';

/**
 * Transaction register filter bar. Reflects the current filter into the URL
 * query string (shareable / back-button friendly) and drives the server
 * component re-render. No client-side data; the server does the filtering via
 * the pure query engine.
 */
import { useRouter } from 'next/navigation';

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
  unclassifiedCount,
}: {
  accountOptions: { id: string; name: string }[];
  /** Category dropdown options — the user's visible assignable set incl. customs
   *  (DECISIONS #111). Hidden categories are still findable via the search box. */
  categoryOptions: { id: string; name: string }[];
  current: { search: string; account: string; category: string; merchant: string; type: string; from: string; to: string; unclassified: boolean; reimbursement: 'awaiting' | 'received' | null };
  /** How many rows in the register still need a category decision, BEFORE this
   *  filter is applied — so the toggle can say what it would find, and can say so
   *  while it is already on. Zero hides the control: a filter that can only ever
   *  return nothing is not a control, it is a dead end. */
  unclassifiedCount: number;
}) {
  const router = useRouter();

  function commit(next: Partial<typeof current>) {
    const merged = { ...current, ...next };
    const q = new URLSearchParams();
    if (merged.search.trim()) q.set('q', merged.search.trim());
    if (merged.account) q.set('account', merged.account);
    if (merged.category) q.set('category', merged.category);
    // Merchant lens filter (DECISIONS #250) — set by tapping a merchant name,
    // preserved across form commits, cleared by Clear / the lens card's link.
    if (merged.merchant) q.set('merchant', merged.merchant);
    if (merged.type && merged.type !== 'all') q.set('type', merged.type);
    if (merged.from) q.set('from', merged.from);
    if (merged.to) q.set('to', merged.to);
    if (merged.unclassified) q.set('unclassified', '1');
    // O.15: the coach's owed-money link sets this — preserved across commits and
    // cleared by Clear, like every other axis (critic P1-4: a filter the bar
    // denies is a dead end wearing a page).
    if (merged.reimbursement) q.set('reimb', merged.reimbursement);
    const qs = q.toString();
    router.push(qs ? `/transactions?${qs}` : '/transactions');
  }

  const hasFilters =
    !!(current.search || current.account || current.category || current.merchant || current.from || current.to) ||
    current.type !== 'all' ||
    current.unclassified ||
    current.reimbursement !== null;

  return (
    <div className="space-y-2" data-testid="txn-filters">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Read the LIVE DOM value, never React state (#216). Text typed before
          // hydration never reaches a controlled input's state, and submitting
          // that stale '' pushed the unfiltered URL — silently eating the query.
          const typed = new FormData(e.currentTarget).get('q');
          commit({ search: typeof typed === 'string' ? typed : '' });
        }}
        className="flex gap-2"
      >
        {/* Uncontrolled by design (#216): the DOM owns what the user typed, so a
            slow hydration can never clobber it. `key` remounts the box with the
            committed value when the URL's search changes (e.g. Clear). */}
        <input
          key={current.search}
          type="search"
          inputMode="search"
          name="q"
          defaultValue={current.search}
          aria-label="Search transactions"
          placeholder="Search transactions…"
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
        {/* Owner request 2026-07-27: "make it easier to see unclassified items in
            activity". FIRST in the row, and the only control here that carries a
            count, because it is the only one that names work waiting to be done
            rather than a way of slicing work already done.

            Hidden at zero on purpose: an always-present "0 need a category" chip
            trains the reader to ignore the one place this number appears, and a
            filter that can only return an empty list is a dead end rather than a
            control. When it is ON it stays visible whatever the count, so the
            reader is never stranded inside a filter with no way to read its state.

            `aria-pressed` rather than a checkbox: this is a view toggle, and the
            count belongs in the accessible name so a screen reader hears the same
            thing the eye sees. */}
        {(unclassifiedCount > 0 || current.unclassified) && (
          <button
            type="button"
            aria-pressed={current.unclassified}
            onClick={() => commit({ unclassified: !current.unclassified })}
            data-testid="txn-filter-unclassified"
            className={`tap-target inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm transition ${
              current.unclassified
                ? 'border-amber-500 bg-amber-50 font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                : 'border-amber-500/60 bg-background text-amber-700 hover:bg-accent dark:text-amber-300'
            }`}
          >
            Needs a category
            <span className="tabular-nums" data-testid="txn-unclassified-count">
              {unclassifiedCount}
            </span>
          </button>
        )}

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

        {current.reimbursement !== null && (
          <button
            type="button"
            aria-pressed
            onClick={() => commit({ reimbursement: null })}
            data-testid="txn-filter-reimb"
            className="tap-target inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-input bg-accent px-3 text-sm font-medium"
          >
            {current.reimbursement === 'awaiting' ? 'Awaiting reimbursement' : 'Reimbursed'}
            <span aria-hidden>×</span>
          </button>
        )}

        {hasFilters && (
          <button
            type="button"
            // current.search → '' remounts the box empty via its key (#216).
            onClick={() => router.push('/transactions')}
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
