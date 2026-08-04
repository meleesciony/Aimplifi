'use client';

/**
 * /transactions → "Shared with you" (TASKS 4.2 slice 3, made ONE-OFF-EDITABLE
 * in slice 6 — HOUSEHOLD_ARCHITECTURE.md §6.1 / T3 / DECISIONS #201). A
 * household member may re-file ONE shared transaction at a time: no "Always"
 * rule, no batch apply, no custom category (system categories only — §4.5
 * never widens category vocabulary across users). This chip+menu is the
 * ENTIRE partner-write surface on shared data (T3) — no pencil for anything
 * else, no merchant-wide affordance, no write-in category.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatISODate, isoDate } from '@/lib/dates';
import { HOUSEHOLD_COPY } from '@/lib/copy/household-copy';
import { cents, formatCents } from '@/lib/money';
import { ASSIGNABLE_GROUPS, filterCategoryOptions } from '@/lib/engine/categorize/assign';
import { recategorizeSharedTransaction } from '@/server/household-actions';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { reloadPreservingScroll } from '@/components/finance/register-scroll';
import type { SharedTxnRow } from '@/server/household';

function amountClass(t: SharedTxnRow): string {
  if (t.isTransfer) return 'text-muted-foreground';
  return t.amountCents > 0 ? 'text-emerald-500' : 'text-foreground';
}

export function SharedTransactionList({
  householdName,
  rows,
  truncated,
}: {
  householdName: string;
  rows: SharedTxnRow[];
  truncated: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Bound to the row that produced it — the same rowId guard the register
  // uses (checker precedent): never lets a stale choice file the wrong row.
  const [chosen, setChosen] = useState<{ rowId: string; id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Plain pending state + withDeadline + full reload on success — NOT
  // useTransition/useActionState (the #164/#166/#167 mutation-form recipe;
  // docs/lessons/mutation-form-recipe.md).
  const [pending, setPending] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpenId(null);
    setChosen(null);
    setError(null);
    setQuery('');
  }, []);

  // Outside-click dismissal (register precedent) — never while a write is in flight.
  useEffect(() => {
    if (openId == null) return;
    function onDocMouseDown(e: MouseEvent) {
      if (pending) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [openId, close, pending]);

  async function commit(t: SharedTxnRow) {
    if (!chosen || chosen.rowId !== t.id || pending) return;
    setError(null);
    setPending(true);
    try {
      const res = await withDeadline(
        recategorizeSharedTransaction({ transactionId: t.id, categoryId: chosen.id }),
        FORM_ACTION_DEADLINE_MS,
      );
      if (!res.ok) {
        setError(res.error);
        setPending(false);
        return;
      }
      // Full reload, not router.refresh(): the re-rendered chip IS the
      // confirmation that can't lie (#167).
      reloadPreservingScroll();
    } catch (e) {
      if (e instanceof ActionDeadline) {
        reloadPreservingScroll(); // write usually committed — re-sync (#164 rule)
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not save — nothing was changed.');
      setPending(false);
    }
  }

  if (rows.length === 0) return null;

  // System categories ONLY — ASSIGNABLE_GROUPS never includes a custom, the
  // viewer's own or the transaction owner's (§4.5).
  const visibleCatGroups = filterCategoryOptions(
    ASSIGNABLE_GROUPS.map((g) => ({ group: g.group, items: g.categories })),
    query,
  );

  const groups: { date: string; items: SharedTxnRow[] }[] = [];
  for (const t of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.date) last.items.push(t);
    else groups.push({ date: t.date, items: [t] });
  }

  return (
    <section className="space-y-3" data-testid="shared-txn-section">
      <div>
        <h2 className="text-base font-semibold">Shared with you — {householdName}</h2>
        <p className="text-xs text-muted-foreground">
          {HOUSEHOLD_COPY.sharedTxnDisclosure()}
          {truncated && <> {HOUSEHOLD_COPY.sharedTxnTruncated(rows.length)}</>}
        </p>
      </div>

      {groups.map((g) => (
        <div key={g.date}>
          <div className="sticky top-0 bg-background/95 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            {formatISODate(isoDate(g.date), 'long')}
          </div>
          <ul className="divide-y rounded-md border">
            {g.items.map((t) => {
              const open = openId === t.id;
              return (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                  data-testid="shared-txn-row"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {/* O.15 slice 1 REFUSAL — this merchant name stays plain text, and
                          it is the one surface in the sweep that does.

                          Every other merchant name in the app names a row the reader
                          OWNS, so `?merchant=` lands on a register containing that row.
                          These rows belong to a PARTNER. The register's personal list is
                          scoped to the viewer (`getTransactions(session.user.id, …)`) and
                          its household section is fetched by `getSharedTransactionsView()`
                          — which takes no filter at all, so it cannot narrow to a
                          merchant even in principle. Following a link from here would
                          land on the reader's OWN charges at that name: a different set
                          from the row they tapped, silently, with no error and an HTTP
                          200 — and where the reader has none, an empty register reading
                          as "there are no charges here" about a charge they are looking
                          straight at.

                          That is the failure `categoryRegisterHref` returns null for
                          (rows right, control wrong), so the same answer applies: refuse
                          rather than assert. Re-open this when the register can filter
                          the household set — then the link is honest and belongs here. */}
                      <span className="truncate font-medium">{t.merchantName}</span>
                      <span
                        className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        data-testid="shared-txn-owner"
                      >
                        {t.ownerLabel}
                      </span>
                      {t.status === 'PENDING' && (
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          Pending
                        </Badge>
                      )}
                      {/* O.15 (critic P2-2): the joint digest's tally drops
                          excluded rows — the list says so on the row itself. */}
                      {t.excludeFromTotals && (
                        <Badge
                          variant="outline"
                          data-testid="shared-txn-excluded-badge"
                          className="shrink-0 border-amber-500/60 text-[10px] text-amber-700 dark:text-amber-300"
                        >
                          Excluded from totals
                        </Badge>
                      )}
                    </div>
                    <div
                      ref={open ? menuRef : undefined}
                      className="relative text-xs text-muted-foreground"
                    >
                      <button
                        type="button"
                        data-testid="shared-txn-category"
                        aria-haspopup="listbox"
                        aria-expanded={open}
                        className="inline-flex items-center gap-1 rounded underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        onClick={() =>
                          open
                            ? close()
                            : (setOpenId(t.id), setChosen(null), setError(null), setQuery(''))
                        }
                      >
                        {t.categoryName}
                        <Pencil className="size-3 opacity-50" aria-hidden />
                      </button>
                      {' · '}
                      <span className="break-all">{t.accountName}</span>

                      {open && (
                        <div
                          role="listbox"
                          data-testid="shared-txn-category-menu"
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              const trigger = menuRef.current?.querySelector<HTMLButtonElement>(
                                '[data-testid="shared-txn-category"]',
                              );
                              close();
                              trigger?.focus();
                            }
                          }}
                          className="absolute left-0 z-50 mt-1 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border bg-card p-1 text-foreground shadow-lg ring-1 ring-foreground/10"
                        >
                          {!chosen || chosen.rowId !== t.id ? (
                            <>
                              <input
                                data-testid="shared-cat-search"
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
                                      data-testid="shared-cat-option"
                                      data-cat={c.id}
                                      disabled={pending}
                                      className="tap-target flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
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
                                <p className="pointer-events-none px-2 py-1.5 text-xs text-muted-foreground">
                                  No matching category.
                                </p>
                              )}
                            </>
                          ) : (
                            <div className="space-y-2 p-1" data-testid="shared-recat-confirm">
                              <p className="text-sm">
                                File as <b>{chosen.name}</b>?
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {HOUSEHOLD_COPY.sharedTxnRecatHint()}
                              </p>
                              <div className="flex flex-col gap-1">
                                <button
                                  type="button"
                                  data-testid="shared-recat-once"
                                  disabled={pending}
                                  className="tap-target inline-flex items-center justify-center rounded bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
                                  onClick={() => commit(t)}
                                >
                                  Just this once
                                </button>
                                <button
                                  type="button"
                                  data-testid="shared-recat-cancel"
                                  disabled={pending}
                                  className="tap-target inline-flex items-center justify-center rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                                  onClick={() => setChosen(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          {error && (
                            <p
                              role="alert"
                              className="px-2 py-1 text-xs text-red-400"
                              data-testid="shared-recat-error"
                            >
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
      ))}
    </section>
  );
}
