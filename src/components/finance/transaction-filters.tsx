'use client';

/**
 * Transaction register filter bar. Reflects the current filter into the URL
 * query string (shareable / back-button friendly) and drives the server
 * component re-render. No client-side data; the server does the filtering via
 * the pure query engine.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatISODate, isoDate } from '@/lib/dates';
import {
  PERIOD_PRESETS,
  PERIOD_PRESET_LABELS,
  calendarYearWindow,
  calendarYearsForPicker,
  matchCalendarYear,
  matchPeriodPreset,
  presetWindow,
  type PeriodPreset,
} from '@/lib/engine/transactions/presets';

const TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'transfer', label: 'Transfers' },
] as const;

const SPEND_CLASS_OPTIONS = [
  { value: '', label: 'All classes' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'guilt-free', label: 'Discretionary' },
] as const;

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground';

export type TransactionFilterState = {
  search: string;
  account: string;
  category: string;
  merchant: string;
  type: string;
  from: string;
  to: string;
  unclassified: boolean;
  reimbursement: 'awaiting' | 'received' | null;
  /** W.7 — empty string = all classes. */
  spendClass: string;
};

/** Shareable register URL. The Needs-a-category chip is a Link to this, so a
 *  click before hydration still filters (#167 / DECISIONS #532). `commit()`
 *  pushes the same string. */
export function transactionsHref(current: TransactionFilterState): string {
  const q = new URLSearchParams();
  if (current.search.trim()) q.set('q', current.search.trim());
  if (current.account) q.set('account', current.account);
  if (current.category) q.set('category', current.category);
  // Merchant lens filter (DECISIONS #250) — set by tapping a merchant name,
  // preserved across form commits, cleared by Clear / the lens card's link.
  if (current.merchant) q.set('merchant', current.merchant);
  if (current.type && current.type !== 'all') q.set('type', current.type);
  if (current.from) q.set('from', current.from);
  if (current.to) q.set('to', current.to);
  if (current.unclassified) q.set('unclassified', '1');
  // O.15: the coach's owed-money link sets this — preserved across commits and
  // cleared by Clear, like every other axis (critic P1-4: a filter the bar
  // denies is a dead end wearing a page).
  if (current.reimbursement) q.set('reimb', current.reimbursement);
  if (current.spendClass) q.set('spendClass', current.spendClass);
  const qs = q.toString();
  return qs ? `/transactions?${qs}` : '/transactions';
}

export function TransactionFilters({
  accountOptions,
  missingAccountOption,
  categoryOptions,
  current,
  unclassifiedCount,
  today,
  oldestDate,
}: {
  accountOptions: { id: string; name: string }[];
  /** Set when `?account=` names an account `accountOptions` does not hold — a
   *  non-spending account (mortgage/loan/investment, resolved to its painted
   *  name) or an id matching no account of the reader's (`name: null`). The
   *  select renders it as an extra option so the control shows the truth:
   *  without it the browser paints "All accounts" while a filter is active,
   *  and choosing All accounts is a silent no-op because the DOM value never
   *  changes (U.3 critic, finding #6). One control per axis — the select IS
   *  the account control, so the fix lives in it rather than beside it. */
  missingAccountOption: { name: string | null } | null;
  /** Category dropdown options — the user's visible assignable set incl. customs
   *  (DECISIONS #111). Hidden categories are still findable via the search box. */
  categoryOptions: { id: string; name: string }[];
  current: TransactionFilterState;
  /** How many rows in the register still need a category decision, BEFORE this
   *  filter is applied — so the toggle can say what it would find, and can say so
   *  while it is already on. Zero hides the control: a filter that can only ever
   *  return nothing is not a control, it is a dead end. */
  unclassifiedCount: number;
  /** Today's business date from the SERVER (provider.today) — the period
   *  presets compute their windows against it, so the dropdown and the
   *  from/to inputs agree with the same "today" the totals use, never with
   *  the browser clock. */
  today: string;
  /** Date of the oldest transaction the reader can see in the CURRENT set, or
   *  null when there are none. Since K.4 (DECISIONS #436) the bound is scoped
   *  by the set-defining axes — the account/category/unclassified filters —
   *  so a reader narrowed to one card sees that card's own depth, and the
   *  printed line always agrees with the empty-state's explanation of a zero
   *  (the K.3 pair, kept together by construction). A period picker promising
   *  "last year" must say how far back the data actually goes — a just-linked
   *  bank has ~90 days, and a preset that silently returns less than its name
   *  is the defect this discloses. */
  oldestDate?: string | null;
}) {
  const router = useRouter();

  function commit(next: Partial<TransactionFilterState>) {
    router.push(transactionsHref({ ...current, ...next }));
  }

  const hasFilters =
    !!(current.search || current.account || current.category || current.merchant || current.from || current.to) ||
    current.type !== 'all' ||
    current.unclassified ||
    current.reimbursement !== null ||
    !!current.spendClass;

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
          <Link
            href={transactionsHref({ ...current, unclassified: !current.unclassified })}
            prefetch={false}
            aria-pressed={current.unclassified}
            data-testid="txn-filter-unclassified"
            className={`tap-target inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm transition ${
              current.unclassified
                ? 'border-warning-500 bg-warning-50 font-medium text-warning-800 dark:bg-warning-950/40 dark:text-warning-200'
                : 'border-warning-500/60 bg-background text-warning-700 hover:bg-accent dark:text-warning-300'
            }`}
          >
            Needs a category
            <span className="tabular-nums" data-testid="txn-unclassified-count">
              {unclassifiedCount}
            </span>
          </Link>
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
          {/* The active filter the options don't hold, injected so the select
              can DISPLAY it and so "All accounts" becomes a live escape (the
              DOM value actually changes). Present only while that filter is
              on — it is a mirror of the URL, never a choice offered. */}
          {missingAccountOption !== null && current.account !== '' && (
            <option value={current.account} data-testid="txn-filter-account-missing-option">
              {missingAccountOption.name !== null ? missingAccountOption.name : '(account not found)'}
            </option>
          )}
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

        <select
          aria-label="Class"
          value={current.spendClass}
          onChange={(e) => commit({ spendClass: e.target.value })}
          data-testid="txn-filter-spend-class"
          className={selectClass}
        >
          {SPEND_CLASS_OPTIONS.map((o) => (
            <option key={o.value || 'all'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {/* Period presets (owner request 2026-08-04: "still need a way to view
            last month, last quarter, last year, etc."). A preset is a named
            from/to pair — picking one commits the same dates a reader could
            type below, and the select shows whichever preset the CURRENT dates
            match ('Custom' when none). The windows are computed against the
            server's business date, so a preset and the totals agree on
            "today". */}
        {(() => {
          const todayIso = isoDate(today);
          const active = matchPeriodPreset(current.from, current.to, todayIso);
          const namedYear = active === 'custom' ? matchCalendarYear(current.from, current.to) : null;
          const value =
            active !== 'custom' ? active : namedYear != null ? `year:${namedYear}` : 'custom';
          const years = calendarYearsForPicker(todayIso, oldestDate ?? null);
          return (
            <select
              aria-label="Period"
              value={value}
              onChange={(e) => {
                const picked = e.target.value;
                if (picked === 'custom') return;
                if (picked.startsWith('year:')) {
                  const year = Number(picked.slice(5));
                  const w = calendarYearWindow(year);
                  commit({ from: w.from ?? '', to: w.to ?? '' });
                  return;
                }
                const w = presetWindow(picked as PeriodPreset, todayIso);
                commit({ from: w.from ?? '', to: w.to ?? '' });
              }}
              data-testid="txn-filter-period"
              className={selectClass}
            >
              {value === 'custom' && <option value="custom">Custom</option>}
              {PERIOD_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {PERIOD_PRESET_LABELS[p]}
                </option>
              ))}
              {years.map((y) => (
                <option key={y} value={`year:${y}`}>
                  {y}
                </option>
              ))}
            </select>
          );
        })()}

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

        {/* The merchant axis, made readable and clearable (owner, 2026-08-07).
            It was the only filter in the bar's predicate with nothing in the
            bar: a reader arriving from any of the dozen merchant links — the
            register's own rows, the lens, /recurring, /trends, the coach —
            landed on a set narrowed by a name they could not see, and when
            that name matched nothing (the match is EXACT on the display name)
            the page showed every control on its default, zero rows, and
            "No transactions match these filters". Same shape as the
            reimbursement chip below, deliberately: one control, states its
            value, clears itself in one tap.

            The name goes into the DOM VERBATIM inside quotes rather than
            summarized — it is the evidence for why the set is empty, and a
            rewritten version of it would be a different string from the one
            being matched. `truncate` clips it VISUALLY at 14rem so a long raw
            descriptor cannot push the × off a 380px screen; the full string
            stays in the accessible name and in the empty-state sentence below,
            which is not clipped. */}
        {current.merchant !== '' && (
          <button
            type="button"
            aria-pressed
            onClick={() => commit({ merchant: '' })}
            data-testid="txn-filter-merchant"
            className="tap-target inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-input bg-accent px-3 text-sm font-medium"
          >
            <span className="max-w-[14rem] truncate">Merchant: “{current.merchant}”</span>
            <span aria-hidden>×</span>
          </button>
        )}

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

      {/* How far back the data actually goes. A period preset that names a
          window older than the reader's history would otherwise return a
          partial answer wearing a complete-sounding name ("Last year" on a
          bank linked three months ago). Stating the span makes the same
          empty-looking result legible instead of mysterious. Hidden when
          there are no transactions at all — the empty register has its own
          copy. */}
      {oldestDate && (
        <p className="text-xs text-muted-foreground" data-testid="txn-history-span">
          History available from {formatISODate(isoDate(oldestDate), 'long')}.
        </p>
      )}
    </div>
  );
}
