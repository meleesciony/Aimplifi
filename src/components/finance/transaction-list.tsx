'use client';

/**
 * Transaction register (380px-first). Rows arrive pre-sorted most-recent-first
 * and are grouped by date. Each row's category is inline-editable (DECISIONS
 * #36): tap it → pick a category → "Just this once" (this transaction) or
 * "Always · all <merchant>" (re-file every transaction of the merchant + a
 * durable rule).
 *
 * Editing state is held HERE, once, with a single open row — NOT per row. The
 * register loads the full set (no pagination yet, ROADMAP #8), so 800+ rows each
 * owning hooks would balloon hydration and delay the search box becoming
 * interactive. One controller + lightweight row buttons keeps hydration cheap.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Pencil, Receipt } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import {
  ASSIGNABLE_GROUPS,
  CUSTOM_CATEGORY_GROUPS,
  filterCategoryOptions,
} from '@/lib/engine/categorize/assign';
import { createCustomCategory } from '@/server/custom-category-actions';
import { recategorize } from '@/server/triage-actions';
import type { PageInfo, TxnSummary, TxnView } from '@/lib/engine/transactions/query';

function amountClass(t: TxnView): string {
  if (t.isTransfer) return 'text-muted-foreground';
  return t.amountCents > 0 ? 'text-emerald-500' : 'text-foreground';
}

export function TransactionList({
  rows,
  summary,
  pageInfo,
  categoryGroups = ASSIGNABLE_GROUPS,
}: {
  rows: TxnView[];
  summary: TxnSummary;
  pageInfo: PageInfo;
  /** Two-level picker source; defaults to the full set, but the page passes the
   *  user's VISIBLE groups so hidden categories don't appear here (DECISIONS #110). */
  categoryGroups?: { group: string; categories: { id: string; name: string }[] }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  // Open the menu UPWARD when the row sits in the lower part of the viewport:
  // dropped-down from a low row it extends past the viewport under the fixed
  // bottom nav — the z-50 menu still out-paints the z-40 nav (checker-verified
  // stacking), but its bottom items render off-screen/overlaid and need a page
  // scroll to reach. Measured one-shot at open; a scroll while open can leave
  // the side stale (accepted P2, STATUS 2026-07-01).
  const [dropUp, setDropUp] = useState(false);

  /** A page URL that preserves the current filters (page 1 drops the param). */
  function pageHref(p: number): string {
    const q = new URLSearchParams(searchParams?.toString() ?? '');
    if (p <= 1) q.delete('page');
    else q.set('page', String(p));
    const qs = q.toString();
    return qs ? `/transactions?${qs}` : '/transactions';
  }
  // `rowId` BINDS the pending choice to the row whose menu produced it: the
  // write-in create resolves ASYNC, and the chip is deliberately not
  // pending-gated, so the user can open another row's menu mid-create — an
  // unbound chosen would put the one-tap confirm pane on the WRONG row
  // (checker P1; the triage twin binds its item at call time).
  const [chosen, setChosen] = useState<{ rowId: string; id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();
  // Write-in "+ New category" inside the picker (#136 increment 3). One
  // controller like the rest of the menu state — never per row.
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatGroup, setNewCatGroup] = useState<string>(CUSTOM_CATEGORY_GROUPS[0] ?? '');
  const [newCatDiscretionary, setNewCatDiscretionary] = useState(true);
  const [newCatError, setNewCatError] = useState<string | null>(null);
  // Wraps the OPEN row's chip + menu so a mousedown outside it dismisses the picker.
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpenId(null);
    setChosen(null);
    setError(null);
    setQuery('');
    setNewCatOpen(false);
    setNewCatError(null);
  }, []);

  // Native-popover dismissal for the open picker: a mousedown anywhere outside the
  // open row's chip+menu closes it (Escape is handled on the menu container so the
  // "+ New category" sub-form's Escape can still close just itself). Scoped to when a
  // menu is open — no global listener otherwise.
  useEffect(() => {
    if (openId == null) return;
    function onDocMouseDown(e: MouseEvent) {
      // Don't abandon the picker on a stray outside click while a create/refile is
      // in flight (the in-menu buttons are disabled for the same reason). Escape is
      // deliberately NOT gated so it stays an escape hatch even if an action stalls.
      if (pending) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [openId, close, pending]);

  /** Open the mini-form with the group prefilled from the row's CURRENT category
   *  (spending groups only — customs never join Income/Transfers) and the NAME
   *  prefilled from the menu's live search query (owner request: what you typed
   *  to search IS the name — never retype it). Overwrites any stale draft. */
  function openNewCat(t: TxnView) {
    const g = categoryGroups.find((grp) => grp.categories.some((c) => c.id === t.categoryId))?.group;
    setNewCatGroup(g && CUSTOM_CATEGORY_GROUPS.includes(g) ? g : (CUSTOM_CATEGORY_GROUPS[0] ?? ''));
    setNewCatName(query.trim());
    setNewCatDiscretionary(true);
    setNewCatError(null);
    setNewCatOpen(true);
  }

  /** Create the category, then hand it to the EXISTING two-step confirm
   *  ("File as X? · once / always") — the register never files in one tap
   *  (DECISIONS #121), so the write-in must not either. */
  function createAndChoose(t: TxnView) {
    const trimmed = newCatName.trim().replace(/\s+/g, ' '); // server-normalization parity
    if (!trimmed || pending) return;
    setNewCatError(null);
    startTransition(async () => {
      let res;
      try {
        res = await createCustomCategory({
          name: trimmed,
          group: newCatGroup,
          discretionary: newCatDiscretionary,
        });
      } catch {
        // Rejected action (network flake / expired session) degrades to the
        // inline error — never the route error boundary (#136 critic P1 class).
        setNewCatError('Could not create that category — nothing was saved. Try again.');
        return;
      }
      if (!res.ok || !res.id) {
        setNewCatError(res.error ?? 'Could not create that category.');
        return;
      }
      setChosen({ rowId: t.id, id: res.id, name: trimmed });
      setNewCatOpen(false);
      setNewCatName('');
      // No manual router.refresh(): createCustomCategory's server-side
      // revalidation already carries the refreshed /transactions payload in
      // the action response (measured — it's what re-populates the picker).
    });
  }

  function commit(t: TxnView, scope: 'one' | 'merchant') {
    if (!chosen || chosen.rowId !== t.id) return; // never file another row's choice
    setError(null);
    startTransition(async () => {
      try {
        await recategorize({ transactionId: t.id, categoryId: chosen.id, scope });
        close();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save — nothing was changed.');
      }
    });
  }

  // Shared group-label-aware search (#137): "bills" must find the visible
  // "Bills & Utilities" group — the previous name-only inline filter had the
  // same duplicate-manufacturing false-negative the triage picker was fixed for.
  const visibleCatGroups = filterCategoryOptions(
    categoryGroups.map((g) => ({ group: g.group, items: g.categories })),
    query,
  );

  // Group consecutive rows by date (input is already date-desc sorted).
  const groups: { date: string; items: TxnView[] }[] = [];
  for (const t of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.date) last.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }

  return (
    <div className="space-y-4" data-testid="txn-list">
      {/* summary strip */}
      <div className="grid grid-cols-3 gap-2 text-sm" data-testid="txn-summary">
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">Money in</div>
          <div className="tabular-nums text-emerald-500" data-testid="summary-in">
            {formatCents(summary.inflowCents)}
          </div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">Money out</div>
          <div className="tabular-nums" data-testid="summary-out">
            {formatCents(summary.outflowCents)}
          </div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-xs text-muted-foreground">Net</div>
          <div
            className={`tabular-nums ${summary.netCents >= 0 ? 'text-emerald-500' : 'text-red-400'}`}
            data-testid="summary-net"
          >
            {formatCents(summary.netCents, { signDisplay: 'always' })}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {summary.count} transaction{summary.count === 1 ? '' : 's'}. Totals exclude
        transfers between your own accounts.
        {pageInfo.total > pageInfo.pageSize && (
          <> Showing {pageInfo.fromIndex}–{pageInfo.toIndex}.</>
        )}
      </p>

      {rows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground"
          data-testid="txn-empty"
        >
          <Receipt className="size-6" aria-hidden />
          No transactions match these filters.
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.date}>
            <div className="sticky top-0 bg-background/95 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
              {formatISODate(isoDate(g.date))}
            </div>
            <ul className="divide-y rounded-md border">
              {g.items.map((t) => {
                const canAlways = Boolean(t.ruleEligible && t.merchantId);
                const open = openId === t.id;
                return (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                    data-testid="txn-row"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{t.merchantName}</span>
                        {t.status === 'PENDING' && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            Pending
                          </Badge>
                        )}
                      </div>
                      <div
                        ref={open ? menuRef : undefined}
                        className="relative text-xs text-muted-foreground"
                      >
                        <button
                          type="button"
                          data-testid="category-chip"
                          aria-haspopup="listbox"
                          aria-expanded={open}
                          className="inline-flex items-center gap-1 rounded underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          onClick={(e) =>
                            open
                              ? close()
                              : (setDropUp(
                                  e.currentTarget.getBoundingClientRect().top >
                                    window.innerHeight * 0.55,
                                ),
                                setOpenId(t.id),
                                setChosen(null),
                                setError(null),
                                setQuery(''),
                                setNewCatOpen(false),
                                setNewCatName(''), // a fresh menu never inherits another row's draft
                                setNewCatError(null))
                          }
                        >
                          {t.categoryName}
                          <Pencil className="size-3 opacity-50" aria-hidden />
                        </button>{' '}
                        · <span className="break-all">{t.accountName}</span>

                        {open && (
                          <div
                            role="listbox"
                            data-testid="category-menu"
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                // return focus to the trigger the keyboard user came from
                                const trigger = menuRef.current?.querySelector<HTMLButtonElement>(
                                  '[data-testid="category-chip"]',
                                );
                                close();
                                trigger?.focus();
                              }
                            }}
                            className={`absolute left-0 z-50 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border bg-card p-1 text-foreground shadow-lg ring-1 ring-foreground/10 ${
                              dropUp ? 'bottom-full mb-1' : 'mt-1'
                            }`}
                          >
                            {!chosen || chosen.rowId !== t.id ? (
                              <>
                                <input
                                  data-testid="cat-search"
                                  autoFocus
                                  value={query}
                                  onChange={(e) => setQuery(e.target.value)}
                                  placeholder="Search categories…"
                                  className="sticky top-0 z-10 mb-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring/50"
                                />
                                {visibleCatGroups.map((grp) => (
                                  <div key={grp.group}>
                                    <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                      {grp.group}
                                    </div>
                                    {grp.items.map((c) => (
                                      <button
                                        key={c.id}
                                        type="button"
                                        role="option"
                                        aria-selected={c.id === t.categoryId}
                                        data-testid="cat-option"
                                        data-cat={c.id}
                                        disabled={pending}
                                        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                                        onClick={() =>
                                          c.id === t.categoryId
                                            ? close()
                                            : setChosen({ rowId: t.id, id: c.id, name: c.name })
                                        }
                                      >
                                        {c.name}
                                        {c.id === t.categoryId && (
                                          <Check className="size-3.5 text-emerald-500" aria-hidden />
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                ))}
                                {visibleCatGroups.length === 0 && (
                                  <p
                                    // pointer-events-none: purely informational — measured
                                    // intercepting the add button's click point (e2e hit-test).
                                    className="pointer-events-none px-2 py-1.5 text-xs text-muted-foreground"
                                    data-testid="register-cat-no-match"
                                  >
                                    No matching category — create it below.
                                  </p>
                                )}
                                {!newCatOpen ? (
                                  <button
                                    type="button"
                                    data-testid="register-add-category"
                                    disabled={pending}
                                    className="mt-1 w-full rounded border border-dashed px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                                    onClick={() => openNewCat(t)}
                                  >
                                    + New category
                                  </button>
                                ) : (
                                  <div
                                    className="mt-1 space-y-1.5 border-t p-1 pt-2"
                                    data-testid="register-new-category"
                                    onKeyDown={(e) => {
                                      // Escape from ANY sub-form control steps back one level (to the
                                      // category list) — stop it reaching the menu container's Escape→close
                                      // so a partly-typed category isn't lost.
                                      if (e.key === 'Escape') {
                                        e.stopPropagation();
                                        setNewCatOpen(false);
                                        setNewCatError(null);
                                      }
                                    }}
                                  >
                                    {newCatError && (
                                      <p role="alert" className="text-xs text-red-400" data-testid="register-new-category-error">
                                        {newCatError}
                                      </p>
                                    )}
                                    <input
                                      value={newCatName}
                                      onChange={(e) => setNewCatName(e.target.value)}
                                      onKeyDown={(e) => {
                                        // Enter creates; Escape is handled by the sub-form container
                                        // (so every sub-form control steps back one level, not just this input).
                                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                          e.preventDefault();
                                          createAndChoose(t);
                                        }
                                      }}
                                      placeholder="e.g. Golf"
                                      aria-label="New category name"
                                      data-testid="register-new-category-name"
                                      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                                      autoFocus
                                    />
                                    <select
                                      value={newCatGroup}
                                      onChange={(e) => setNewCatGroup(e.target.value)}
                                      aria-label="Group for the new category"
                                      data-testid="register-new-category-group"
                                      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                                    >
                                      {CUSTOM_CATEGORY_GROUPS.map((g) => (
                                        <option key={g} value={g}>
                                          {g}
                                        </option>
                                      ))}
                                    </select>
                                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                      <input
                                        type="checkbox"
                                        checked={newCatDiscretionary}
                                        onChange={(e) => setNewCatDiscretionary(e.target.checked)}
                                        data-testid="register-new-category-discretionary"
                                      />
                                      Discretionary
                                    </label>
                                    <div className="flex gap-1.5">
                                      <button
                                        type="button"
                                        data-testid="register-new-category-submit"
                                        disabled={pending || !newCatName.trim()}
                                        className="rounded bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
                                        onClick={() => createAndChoose(t)}
                                      >
                                        Create
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
                                        onClick={() => {
                                          setNewCatOpen(false);
                                          setNewCatError(null);
                                        }}
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="space-y-2 p-1" data-testid="recat-confirm">
                                <p className="text-sm">
                                  File as <b>{chosen.name}</b>?
                                </p>
                                <div className="flex flex-col gap-1">
                                  <button
                                    type="button"
                                    data-testid="recat-once"
                                    disabled={pending}
                                    className="rounded bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
                                    onClick={() => commit(t, 'one')}
                                  >
                                    Just this once
                                  </button>
                                  {canAlways && (
                                    <button
                                      type="button"
                                      data-testid="recat-always"
                                      disabled={pending}
                                      className="rounded border px-2 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
                                      onClick={() => commit(t, 'merchant')}
                                    >
                                      Always — re-file all {t.merchantCount ?? ''} {t.merchantName}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    data-testid="recat-cancel"
                                    disabled={pending}
                                    className="rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                                    onClick={() => setChosen(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                                {canAlways && (
                                  <p className="text-[11px] text-muted-foreground">
                                    Re-files all {t.merchantCount ?? ''} past {t.merchantName} charges and
                                    auto-files every future one. Undo from the review inbox.
                                  </p>
                                )}
                              </div>
                            )}
                            {error && (
                              <p role="alert" className="px-2 py-1 text-xs text-red-400" data-testid="recat-error">
                                {error}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={`shrink-0 tabular-nums ${amountClass(t)}`}>
                      {formatCents(cents(t.amountCents), { signDisplay: 'always' })}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}

      {pageInfo.pageCount > 1 && (
        <nav
          className="flex items-center justify-between gap-2 pt-1 text-xs"
          aria-label="Transaction pages"
          data-testid="txn-pagination"
        >
          {pageInfo.page > 1 ? (
            <Link href={pageHref(pageInfo.page - 1)} data-testid="txn-prev-page" className="rounded-md border px-3 py-1.5 hover:bg-accent">
              ← Prev
            </Link>
          ) : (
            <span className="rounded-md border px-3 py-1.5 text-muted-foreground opacity-40" aria-disabled="true">← Prev</span>
          )}
          <span className="text-muted-foreground" data-testid="txn-page-indicator">
            Page {pageInfo.page} of {pageInfo.pageCount}
          </span>
          {pageInfo.page < pageInfo.pageCount ? (
            <Link href={pageHref(pageInfo.page + 1)} data-testid="txn-next-page" className="rounded-md border px-3 py-1.5 hover:bg-accent">
              Next →
            </Link>
          ) : (
            <span className="rounded-md border px-3 py-1.5 text-muted-foreground opacity-40" aria-disabled="true">Next →</span>
          )}
        </nav>
      )}
    </div>
  );
}
