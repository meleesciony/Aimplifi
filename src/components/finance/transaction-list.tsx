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
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MERCHANT_LINK_CLASS, merchantRegisterHref } from '@/lib/engine/transactions/links';
import { useSearchParams } from 'next/navigation';
import { Check, Pencil, Receipt, Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import {
  ASSIGNABLE_GROUPS,
  CUSTOM_CATEGORY_GROUPS,
  filterCategoryOptions,
} from '@/lib/engine/categorize/assign';
import { TAX_CLASSES, TAX_CLASS_LABELS, taxClassLabel } from '@/lib/engine/tax/classes';
import { TXN_NOTE_MAX_CHARS } from '@/lib/engine/tax/note';
import { createCustomCategory } from '@/server/custom-category-actions';
import { setTransactionTax } from '@/server/tax-actions';
import { recategorize } from '@/server/triage-actions';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import {
  PROVENANCE_BADGE_TESTID,
  PROVENANCE_CONFIRM_TESTID,
  provenanceBadgeView,
} from '@/components/finance/provenance-badge';
import type { PageInfo, TxnSummary, TxnView } from '@/lib/engine/transactions/query';

/**
 * What the row's note/tax control says without being opened.
 *
 * The tag wins over the note because the tag is the thing a report groups by — a
 * reader scanning for "did I tag this" needs to see the answer, and the note's
 * contents are the reader's own prose, which has no business being printed into a
 * dense register row it might not fit in. `taxClassLabel` returns null for a value
 * this build does not recognize, which correctly reads as untagged.
 */
function taxTriggerLabel(t: TxnView): string {
  return taxClassLabel(t.taxClass) ?? (t.note ? 'Note' : 'Tag');
}

function amountClass(t: TxnView): string {
  if (t.isTransfer) return 'text-muted-foreground';
  return t.amountCents > 0 ? 'text-emerald-500' : 'text-foreground';
}

export function TransactionList({
  rows,
  summary,
  pageInfo,
  categoryGroups = ASSIGNABLE_GROUPS,
  hasFilters = false,
}: {
  rows: TxnView[];
  summary: TxnSummary;
  pageInfo: PageInfo;
  /** Two-level picker source; defaults to the full set, but the page passes the
   *  user's VISIBLE groups so hidden categories don't appear here (DECISIONS #110). */
  categoryGroups?: { group: string; categories: { id: string; name: string }[] }[];
  /** True when any register filter is active — distinguishes "no data yet" from
   *  "filters matched nothing" (ROADMAP ALSO CONSIDER / #186). */
  hasFilters?: boolean;
}) {
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
  // Deliberately NOT useTransition (#167, the #164/#166 recipe): plain pending
  // state + a deadline-bounded await + a full reload on refile. The old
  // useTransition + router.refresh() path lost the chip update ~50% at human
  // pacing (scripts/audit-probes/recategorize-mutation.ts: 0/2 rounds landed
  // pre-#167; also the transactions.spec.ts:145 e2e flake).
  const [pending, setPending] = useState(false);
  // A confirm-an-AI-guess failure is bound to its row (the confirm control lives
  // outside the category menu that owns `error`, so it needs its own surface).
  const [confirmError, setConfirmError] = useState<{ id: string; msg: string } | null>(null);
  // Write-in "+ New category" inside the picker (#136 increment 3). One
  // controller like the rest of the menu state — never per row.
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatGroup, setNewCatGroup] = useState<string>(CUSTOM_CATEGORY_GROUPS[0] ?? '');
  const [newCatDiscretionary, setNewCatDiscretionary] = useState(true);
  const [newCatError, setNewCatError] = useState<string | null>(null);
  // Wraps the OPEN row's chip + menu so a mousedown outside it dismisses the picker.
  const menuRef = useRef<HTMLDivElement>(null);

  // --- Note + tax tag (O.1) ----------------------------------------------------
  // A SECOND, independent controller rather than a third mode inside the category
  // menu above: that menu carries the #136/#167 two-step-confirm behaviour and its
  // own e2e locks, and threading an unrelated editor through `chosen`/`newCatOpen`
  // would put a note draft one state transition away from a mis-file. Same
  // single-open-row discipline, same deadline+reload write recipe, zero overlap.
  const [taxOpenId, setTaxOpenId] = useState<string | null>(null);
  const [taxDropUp, setTaxDropUp] = useState(false);
  const [taxDraft, setTaxDraft] = useState<{ taxClass: string; note: string }>({ taxClass: '', note: '' });
  const [taxBusy, setTaxBusy] = useState(false);
  const [taxError, setTaxError] = useState<string | null>(null);
  const taxRef = useRef<HTMLDivElement>(null);

  const closeTax = useCallback(() => {
    setTaxOpenId(null);
    setTaxError(null);
  }, []);

  useEffect(() => {
    if (taxOpenId == null) return;
    function onDocMouseDown(e: MouseEvent) {
      // Never abandon a half-typed note because of a stray outside click while the
      // save is in flight — same rule the category menu follows.
      if (taxBusy) return;
      if (taxRef.current && !taxRef.current.contains(e.target as Node)) closeTax();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [taxOpenId, closeTax, taxBusy]);

  /** Save the note + tag together. Both fields always travel: the panel edits them
   *  as one thing, so "cleared" and "untouched" must not be the same message. */
  async function saveTax(t: TxnView) {
    if (taxBusy) return;
    setTaxError(null);
    setTaxBusy(true);
    let res;
    try {
      res = await withDeadline(
        setTransactionTax({
          transactionId: t.id,
          taxClass: taxDraft.taxClass === '' ? null : taxDraft.taxClass,
          note: taxDraft.note,
        }),
        FORM_ACTION_DEADLINE_MS,
      );
    } catch (e) {
      if (e instanceof ActionDeadline) {
        window.location.reload(); // write usually committed — re-sync (#164 rule)
        return;
      }
      setTaxError('Could not save — nothing was changed. Try again.');
      setTaxBusy(false);
      return;
    }
    if (!res.ok) {
      setTaxError(res.error);
      setTaxBusy(false);
      return;
    }
    // Full reload, never router.refresh(): the re-rendered row is the confirmation
    // that can't lie (#167). `taxBusy` stays true until the new page arrives.
    window.location.reload();
  }

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
   *  ("File as X? · once / always") — the register's PICKER never files in one
   *  tap (DECISIONS #121; a menu tap selects, it doesn't assert), so the
   *  write-in must not either. The O.9d suggestion chip is the deliberate
   *  exception (#333): its proposition is rendered before the tap. */
  async function createAndChoose(t: TxnView) {
    const trimmed = newCatName.trim().replace(/\s+/g, ' '); // server-normalization parity
    if (!trimmed || pending) return;
    setNewCatError(null);
    setPending(true);
    let res;
    try {
      res = await withDeadline(
        createCustomCategory({ name: trimmed, group: newCatGroup, discretionary: newCatDiscretionary }),
        FORM_ACTION_DEADLINE_MS,
      );
    } catch (e) {
      if (e instanceof ActionDeadline) {
        // The create usually COMMITTED and only the confirmation stream was
        // severed — re-sync; if it saved, the category is in the picker (#164 rule).
        window.location.reload();
        return;
      }
      // Rejected action (network flake / expired session) degrades to the
      // inline error — never the route error boundary (#136 critic P1 class).
      setNewCatError('Could not create that category — nothing was saved. Try again.');
      setPending(false);
      return;
    }
    setPending(false);
    if (!res.ok || !res.id) {
      setNewCatError(res.error ?? 'Could not create that category.');
      return;
    }
    setChosen({ rowId: t.id, id: res.id, name: trimmed });
    setNewCatOpen(false);
    setNewCatName('');
    // No manual refresh: createCustomCategory's server-side revalidation
    // already carries the refreshed /transactions payload in the action
    // response (measured — it's what re-populates the picker).
  }

  async function commit(t: TxnView, scope: 'one' | 'merchant') {
    if (!chosen || chosen.rowId !== t.id || pending) return; // never file another row's choice
    setError(null);
    setPending(true);
    try {
      await withDeadline(
        recategorize({ transactionId: t.id, categoryId: chosen.id, scope }),
        FORM_ACTION_DEADLINE_MS,
      );
      // Full reload, not router.refresh(): refresh's application was the
      // coin-flip the probe witnessed — the re-rendered chip is the
      // confirmation that can't lie. pending stays true until the new page.
      window.location.reload();
    } catch (e) {
      if (e instanceof ActionDeadline) {
        window.location.reload(); // write usually committed — re-sync (#164 rule)
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not save — nothing was changed.');
      setPending(false);
    }
  }

  /**
   * Confirm an AI guess (Why-This-Category §3.1): the user OKs the category the
   * model proposed. Files the row's CURRENT category — which, for an `ai-guess`
   * verdict, equals the predicted one by construction (the resolver returns
   * `ai-guess` only when predicted === current) — through the SAME correction
   * path every other recategorization uses. `scope: 'one'` records a Correction
   * and stamps the prediction's `labeledAt`, so on reload the row reads
   * `user-set` (a human confirmed it) and the confirm control is gone. No rule is
   * minted: confirming one charge is not "always for this merchant".
   */
  async function confirmGuess(t: TxnView) {
    if (pending) return;
    setConfirmError(null);
    setPending(true);
    try {
      await withDeadline(
        recategorize({ transactionId: t.id, categoryId: t.categoryId, scope: 'one' }),
        FORM_ACTION_DEADLINE_MS,
      );
      window.location.reload();
    } catch (e) {
      if (e instanceof ActionDeadline) {
        window.location.reload(); // write usually committed — re-sync (#164 rule)
        return;
      }
      setConfirmError({ id: t.id, msg: e instanceof Error ? e.message : 'Could not confirm — nothing was changed.' });
      setPending(false);
    }
  }

  /**
   * Confirm the suggestion chip (O.9d / DECISIONS #333): file the UNFILED row as
   * the category the chip already states. One tap is licensed here — unlike the
   * picker's two-step #121 rule — because the proposition (category + its origin
   * label, plus the evidence sentence for history proposals) is rendered BEFORE
   * the tap; the tap asserts it rather than selecting it. Same correction path
   * as every other recategorization (`scope: 'one'` — confirming one charge is
   * not "always for this merchant"), so the filing feeds the learner and the
   * row reloads as user-set.
   */
  async function confirmSuggestion(t: TxnView) {
    if (!t.suggestion || pending) return;
    setConfirmError(null);
    setPending(true);
    try {
      await withDeadline(
        // expectUnfiled: the tap asserts "this row is still unfiled" — the server
        // re-proves it in-transaction so a stale chip can never overwrite a
        // category chosen since the page loaded (another tab, a partner, triage).
        recategorize({ transactionId: t.id, categoryId: t.suggestion.categoryId, scope: 'one', expectUnfiled: true }),
        FORM_ACTION_DEADLINE_MS,
      );
      window.location.reload();
    } catch (e) {
      if (e instanceof ActionDeadline) {
        window.location.reload(); // write usually committed — re-sync (#164 rule)
        return;
      }
      setConfirmError({ id: t.id, msg: e instanceof Error ? e.message : 'Could not confirm — nothing was changed.' });
      setPending(false);
    }
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
        <div className="min-w-0 rounded-md border p-2">
          <div className="text-xs text-muted-foreground">Money in</div>
          <div className="break-words tabular-nums text-emerald-500" data-testid="summary-in">
            {formatCents(summary.inflowCents)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border p-2">
          <div className="text-xs text-muted-foreground">Money out</div>
          <div className="break-words tabular-nums" data-testid="summary-out">
            {formatCents(summary.outflowCents)}
          </div>
        </div>
        <div className="min-w-0 rounded-md border p-2">
          <div className="text-xs text-muted-foreground">Net</div>
          <div
            className={`break-words tabular-nums ${summary.netCents >= 0 ? 'text-emerald-500' : 'text-red-400'}`}
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
          {hasFilters
            ? 'No transactions match these filters.'
            : 'No transactions yet. Add one, import a CSV, or connect an account.'}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.date}>
            {/* 'long' (#166): the register spans years — "Wed, Jan 15" with no year
                made Jan 2025 indistinguishable from Jan 2026. */}
            <div className="sticky top-0 bg-background/95 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
              {formatISODate(isoDate(g.date), 'long')}
            </div>
            <ul className="divide-y rounded-md border">
              {g.items.map((t) => {
                const canAlways = Boolean(t.ruleEligible && t.merchantId);
                const open = openId === t.id;
                const taxOpen = taxOpenId === t.id;
                const pv = provenanceBadgeView(t.provenance);
                return (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                    data-testid="txn-row"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Merchant Pattern Lens entry (DECISIONS #250): the name
                            links to the merchant-filtered register + lens card. */}
                        <Link
                          href={merchantRegisterHref(t.merchantName)}
                          data-testid="txn-merchant-link"
                          className={`truncate ${MERCHANT_LINK_CLASS}`}
                        >
                          {t.merchantName}
                        </Link>
                        {t.status === 'PENDING' && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            Pending
                          </Badge>
                        )}
                        {/* O.13b — the detail view: one place carrying this row's
                            whole field set, including the split the register
                            could not reach and the bank text it does not show.
                            `prefetch={false}` for the same reason as the rule
                            link below: one link per ROW would otherwise fire a
                            dynamic RSC request per visible transaction on every
                            register load. */}
                        <Link
                          href={`/transactions/${encodeURIComponent(t.id)}`}
                          prefetch={false}
                          data-testid="txn-detail-link"
                          aria-label={`Open the details of this ${t.merchantName} transaction`}
                          className="tap-target inline-flex shrink-0 items-center justify-center rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          Details
                        </Link>
                        {/* O.13b — the rule lever, ON THE ROW. Owner, 2026-07-30:
                            "whenever clicking a transaction, should have rules pull
                            up so you can change specifically for that transaction…
                            Having to remember which transaction and how to populate
                            them exactly as written is too cumbersome." The link
                            carries the transaction id, and `/rules` fills the key
                            in from THIS row's statement text. */}
                        <Link
                          href={`/rules?from=${encodeURIComponent(t.id)}`}
                          // One link per ROW, so the default viewport prefetch
                          // would fire a dynamic RSC request per visible
                          // transaction on every register load — for an action
                          // that is taken on one row in a hundred. Measured: the
                          // register's own e2e began failing its post-click
                          // navigation under 4-worker contention once this link
                          // was added, and passed serially.
                          prefetch={false}
                          data-testid="txn-rule-link"
                          aria-label={`Create a categorization rule from this ${t.merchantName} transaction`}
                          className="tap-target inline-flex shrink-0 items-center justify-center rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          Rule…
                        </Link>
                        {/* Why-This-Category (§3.1): who decided this category. The
                            label is the resolver's verdict, rendered verbatim — an
                            AI guess is the ONLY kind that asks for the user's OK. */}
                        <Badge
                          variant="outline"
                          data-testid={PROVENANCE_BADGE_TESTID}
                          data-kind={pv.kind}
                          title="Why this category"
                          className={`shrink-0 text-[10px] ${
                            pv.tone === 'attention'
                              ? 'border-amber-500/60 text-amber-700 dark:text-amber-300'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {pv.label}
                        </Badge>
                        {pv.showConfirm && (
                          <button
                            type="button"
                            data-testid={PROVENANCE_CONFIRM_TESTID}
                            disabled={pending}
                            onClick={() => confirmGuess(t)}
                            aria-label={`Confirm the AI-suggested category ${t.categoryName} for ${t.merchantName}`}
                            className="tap-target inline-flex shrink-0 items-center justify-center rounded border border-amber-500/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-300"
                          >
                            Confirm
                          </button>
                        )}
                        {/* Suggestion ladder chip (O.9d): what the app thinks this
                            UNFILED row is, with its origin, + a one-tap confirm.
                            Same labels as the inbox (triage-inbox.tsx) — the two
                            surfaces answer one question from one ladder. */}
                        {t.suggestion && (
                          <>
                            <Badge
                              variant="outline"
                              data-testid="register-suggestion"
                              data-kind={t.suggestion.kind}
                              className="shrink-0 text-[10px] text-muted-foreground"
                            >
                              {t.suggestion.categoryName}
                              <span className="ml-1 font-normal">
                                {t.suggestion.kind === 'provider'
                                  ? '· Plaid’s guess'
                                  : t.suggestion.kind === 'history'
                                    ? '· from your history'
                                    : '· suggested'}
                              </span>
                            </Badge>
                            <button
                              type="button"
                              data-testid="register-suggestion-confirm"
                              disabled={pending}
                              onClick={() => confirmSuggestion(t)}
                              aria-label={`File ${t.merchantName} as the suggested category ${t.suggestion.categoryName}`}
                              className="tap-target inline-flex shrink-0 items-center justify-center rounded border px-1.5 py-0.5 text-[10px] font-medium hover:bg-accent disabled:opacity-50"
                            >
                              ✓ Confirm
                            </button>
                          </>
                        )}
                      </div>
                      {t.suggestion?.reason && (
                        <p
                          className="mt-0.5 text-[11px] text-muted-foreground"
                          data-testid="register-suggestion-reason"
                        >
                          {t.suggestion.reason}
                        </p>
                      )}
                      {confirmError?.id === t.id && (
                        <p
                          role="alert"
                          className="mt-0.5 text-[11px] text-red-400"
                          data-testid="provenance-confirm-error"
                        >
                          {confirmError.msg}
                        </p>
                      )}
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
                        · <span className="break-all">{t.accountName}</span>{' '}
                        {/* Note + tax tag (O.1). Sits on the SAME line as the category
                            chip on purpose: a control on its own line would add a line
                            to every row in the register, and a uniform row-height shift
                            is what broke the #136 confirm lock once already. Truncated
                            rather than wrapping, so a long class label cannot grow the
                            row either. */}
                        <span ref={taxOpen ? taxRef : undefined} className="relative inline-block">
                          <button
                            type="button"
                            data-testid="txn-tax-trigger"
                            data-tagged={t.taxClass ? 'yes' : 'no'}
                            aria-haspopup="dialog"
                            aria-expanded={taxOpen}
                            aria-label={`Note and tax tag for ${t.merchantName}`}
                            className="tap-target inline-flex max-w-[9rem] items-center gap-1 rounded align-middle underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            onClick={(e) => {
                              if (taxOpen) {
                                closeTax();
                                return;
                              }
                              close(); // never leave the category picker open behind this
                              setTaxDropUp(
                                e.currentTarget.getBoundingClientRect().top > window.innerHeight * 0.55,
                              );
                              // The draft is seeded from the ROW, every time it opens, so
                              // it can never inherit another row's half-typed note.
                              setTaxDraft({ taxClass: t.taxClass ?? '', note: t.note ?? '' });
                              setTaxError(null);
                              setTaxOpenId(t.id);
                            }}
                          >
                            <Tag className="size-3 shrink-0 opacity-50" aria-hidden />
                            <span className="truncate">{taxTriggerLabel(t)}</span>
                          </button>

                          {taxOpen && (
                            <div
                              role="dialog"
                              aria-label="Note and tax tag"
                              data-testid="txn-tax-panel"
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  const trigger = taxRef.current?.querySelector<HTMLButtonElement>(
                                    '[data-testid="txn-tax-trigger"]',
                                  );
                                  closeTax();
                                  trigger?.focus();
                                }
                              }}
                              className={`absolute left-0 z-50 w-72 max-w-[calc(100vw-2rem)] space-y-2 rounded-lg border bg-card p-2 text-left text-foreground shadow-lg ring-1 ring-foreground/10 ${
                                taxDropUp ? 'bottom-full mb-1' : 'mt-1'
                              }`}
                            >
                              <div>
                                <label
                                  className="mb-1 block text-[11px] font-medium text-muted-foreground"
                                  htmlFor={`tax-class-${t.id}`}
                                >
                                  Tax category
                                </label>
                                <select
                                  id={`tax-class-${t.id}`}
                                  data-testid="txn-tax-class"
                                  value={taxDraft.taxClass}
                                  disabled={taxBusy}
                                  onChange={(e) => setTaxDraft((d) => ({ ...d, taxClass: e.target.value }))}
                                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
                                >
                                  <option value="">Not tagged</option>
                                  {TAX_CLASSES.map((c) => (
                                    <option key={c} value={c}>
                                      {TAX_CLASS_LABELS[c]}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label
                                  className="mb-1 block text-[11px] font-medium text-muted-foreground"
                                  htmlFor={`tax-note-${t.id}`}
                                >
                                  Note
                                </label>
                                <textarea
                                  id={`tax-note-${t.id}`}
                                  data-testid="txn-tax-note"
                                  rows={2}
                                  maxLength={TXN_NOTE_MAX_CHARS}
                                  value={taxDraft.note}
                                  disabled={taxBusy}
                                  onChange={(e) => setTaxDraft((d) => ({ ...d, note: e.target.value }))}
                                  placeholder="What was this? e.g. Mum's prescription"
                                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
                                />
                              </div>
                              {taxError && (
                                <p role="alert" className="text-xs text-red-400" data-testid="txn-tax-error">
                                  {taxError}
                                </p>
                              )}
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  data-testid="txn-tax-save"
                                  disabled={taxBusy}
                                  className="tap-target inline-flex items-center justify-center rounded bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
                                  onClick={() => saveTax(t)}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  data-testid="txn-tax-cancel"
                                  disabled={taxBusy}
                                  className="tap-target inline-flex items-center justify-center rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                                  onClick={closeTax}
                                >
                                  Cancel
                                </button>
                              </div>
                              {/* The claim this feature refuses to make, said where the
                                  tagging happens rather than only in the export. */}
                              <p className="text-[11px] text-muted-foreground">
                                Your own filing — Aimplifi doesn&apos;t decide what&apos;s deductible. Export a
                                whole tax year from Settings.
                              </p>
                            </div>
                          )}
                        </span>

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
                                    className="tap-target mt-1 flex w-full items-center rounded border border-dashed px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
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
                                        className="tap-target inline-flex items-center justify-center rounded bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
                                        onClick={() => createAndChoose(t)}
                                      >
                                        Create
                                      </button>
                                      <button
                                        type="button"
                                        className="tap-target inline-flex items-center justify-center rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
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
                                    className="tap-target inline-flex items-center justify-center rounded bg-primary px-2 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
                                    onClick={() => commit(t, 'one')}
                                  >
                                    Just this once
                                  </button>
                                  {canAlways && (
                                    <button
                                      type="button"
                                      data-testid="recat-always"
                                      disabled={pending}
                                      className="tap-target inline-flex items-center justify-center rounded border px-2 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
                                      onClick={() => commit(t, 'merchant')}
                                    >
                                      Always — re-file all {t.merchantCount ?? ''} {t.merchantName}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    data-testid="recat-cancel"
                                    disabled={pending}
                                    className="tap-target inline-flex items-center justify-center rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
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
            <Link href={pageHref(pageInfo.page - 1)} data-testid="txn-prev-page" className="tap-target inline-flex items-center justify-center rounded-md border px-3 py-1.5 hover:bg-accent">
              ← Prev
            </Link>
          ) : (
            <span className="rounded-md border px-3 py-1.5 text-muted-foreground opacity-40" aria-disabled="true">← Prev</span>
          )}
          <span className="text-muted-foreground" data-testid="txn-page-indicator">
            Page {pageInfo.page} of {pageInfo.pageCount}
          </span>
          {pageInfo.page < pageInfo.pageCount ? (
            <Link href={pageHref(pageInfo.page + 1)} data-testid="txn-next-page" className="tap-target inline-flex items-center justify-center rounded-md border px-3 py-1.5 hover:bg-accent">
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
