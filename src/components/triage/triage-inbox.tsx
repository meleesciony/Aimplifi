'use client';

/**
 * Triage inbox — MERCHANT-GROUP first (PULSE_CATEGORIZATION_FIX Phase 3c),
 * built for thumbs (380px first).
 *
 * One card = one MERCHANT (all its queued transactions, every descriptor
 * variant): one decision files them all, and — for rule-eligible merchants —
 * creates the durable rule so the merchant never re-surfaces (DECISIONS #143).
 * The Phase-2 baseline measured the old per-transaction flow at 397
 * interactions for a 144-row / 24-merchant queue; this collapses the queue to
 * its real size: decisions.
 *
 *  - "File all N as X" (or swipe RIGHT) = accept the honest suggestion, when
 *    one exists (no more amount-based 'Shopping' guesses)
 *  - "⋯ Pick" (or swipe LEFT) = quick-picks + searchable all-category picker
 *    (+ write-in custom categories, #136/#139) — the pick files the whole group
 *  - "☰ One by one" (or long-press) = drill into the group's rows for the rare
 *    mixed-merchant case: per-row pick / split, with the classic "Always / Just
 *    this once" rule prompt (#36) for singles
 *  - universal undo (inverse corrections; created rules removed)
 *  - aggregates (Zelle/checks/ATM/Venmo) group by EXACT descriptor and never
 *    create rules (#23)
 *
 * Instrumentation: every user interaction appends to window.__triageLog so the
 * Phase 2 e2e can count interactions and map them to the documented human-time
 * budget. See tests/e2e/phase2-triage.spec.ts.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { PartyPopper, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatISODate, isoDate } from '@/lib/dates';
import { CUSTOM_CATEGORY_GROUPS, filterCategoryOptions } from '@/lib/engine/categorize/assign';
import { isConfidentGroup, summarizeConfident } from '@/lib/engine/categorize/group';
import { cents, centsFromDollarString, formatCents } from '@/lib/money';
import type { TriageGroupView } from '@/server/triage';
import { createCustomCategory } from '@/server/custom-category-actions';
import {
  acceptAllConfident,
  applyCategory,
  fileMerchantGroup,
  makeRuleFromCorrection,
  splitTransaction,
  undoCorrections,
  undoSplit,
} from '@/server/triage-actions';

declare global {
  interface Window {
    __triageLog?: { type: string; detail: string; at: number }[];
  }
}

function logInteraction(type: string, detail: string) {
  if (typeof window === 'undefined') return;
  window.__triageLog = window.__triageLog ?? [];
  window.__triageLog.push({ type, detail, at: window.__triageLog.length + 1 });
}

type UndoEntry =
  | { kind: 'corrections'; correctionIds: string[]; label: string }
  | { kind: 'split'; transactionId: string; label: string };

interface RulePrompt {
  correctionId: string;
  merchant: string;
  categoryName: string;
}

type GroupRow = TriageGroupView['rows'][number];

/** How many groups one "pass" frames (the fix-doc's 15-20 visible cap). */
const PASS_SIZE = 15;

export function TriageInbox({
  initialGroups,
  categories,
}: {
  initialGroups: TriageGroupView[];
  categories: { id: string; name: string; group?: string }[];
}) {
  const [groups, setGroups] = useState(initialGroups);
  const [mode, setMode] = useState<'idle' | 'picker' | 'split' | 'singles'>('idle');
  /** In singles mode: the row the open picker/split targets (null = none open). */
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [singlesTool, setSinglesTool] = useState<'pick' | 'split' | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [rulePrompt, setRulePrompt] = useState<RulePrompt | null>(null);
  const [splitFirstHalf, setSplitFirstHalf] = useState<string>('');
  const [splitFirstCat, setSplitFirstCat] = useState<string>('');
  const [splitSecondCat, setSplitSecondCat] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dragX, setDragX] = useState(0);
  const dragStart = useRef<number | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Categories created THIS session via the write-in form (#136). The server
  // revalidates /triage, but this client island keeps its state — the overlay
  // makes a fresh category assignable on the very next card without a reload.
  const [extraCategories, setExtraCategories] = useState<
    { id: string; name: string; group: string }[]
  >([]);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatGroup, setNewCatGroup] = useState<string>(CUSTOM_CATEGORY_GROUPS[0] ?? '');
  const [newCatDiscretionary, setNewCatDiscretionary] = useState(true);
  const [newCatError, setNewCatError] = useState<string | null>(null);
  // Search query for the "any category" picker (#137).
  const [catQuery, setCatQuery] = useState('');
  const pickerPanelRef = useRef<HTMLDivElement | null>(null);
  // Focus lands here after a bulk "Accept all" so it never falls to <body> when the
  // banner button unmounts itself (a11y SC 2.4.3 focus order).
  const countRef = useRef<HTMLSpanElement | null>(null);
  // Keyboard path (critic P1): focus the PANEL itself (tabIndex -1) when it
  // opens — focusing a child button would silently no-op while disabled.
  useEffect(() => {
    if (mode === 'picker') pickerPanelRef.current?.focus();
  }, [mode]);

  const top = groups[0];

  // Overlay bridge → prune once the server list knows the id (critic P2).
  useEffect(() => {
    setExtraCategories((xs) => {
      if (xs.length === 0) return xs;
      const pruned = xs.filter((c) => !categories.some((k) => k.id === c.id));
      return pruned.length === xs.length ? xs : pruned;
    });
  }, [categories]);
  const allCats = useMemo(() => {
    if (extraCategories.length === 0) return categories;
    const known = new Set(categories.map((c) => c.id));
    const extras = extraCategories.filter((c) => !known.has(c.id));
    return extras.length === 0 ? categories : [...categories, ...extras];
  }, [categories, extraCategories]);
  const nameOf = (id: string) => allCats.find((c) => c.id === id)?.name ?? id;

  const categoryGroups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, { id: string; name: string }[]>();
    for (const c of allCats) {
      const g = c.group ?? 'Other';
      if (!byGroup.has(g)) {
        byGroup.set(g, []);
        order.push(g);
      }
      byGroup.get(g)!.push({ id: c.id, name: c.name });
    }
    return order.map((g) => ({ group: g, items: byGroup.get(g)! }));
  }, [allCats]);

  function resetTransient() {
    setMode('idle');
    setActiveRowId(null);
    setSinglesTool(null);
    setDragX(0);
    setSplitFirstHalf('');
    setSplitFirstCat('');
    setSplitSecondCat('');
    setNewCatOpen(false);
    setNewCatError(null);
    setCatQuery('');
  }

  function advanceGroup() {
    setGroups((gs) => gs.slice(1));
    resetTransient();
  }

  /** Optimistic update with rollback (critic F6): a failed action restores the
   *  queue and surfaces the error — a correction is never silently lost. */
  function runAction(rollback: TriageGroupView[], fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        setGroups(rollback);
        setMode('idle');
        setActiveRowId(null);
        setSinglesTool(null);
        setError(e instanceof Error ? e.message : 'Something went wrong — nothing was saved.');
      }
    });
  }

  /** File the WHOLE group: one decision, all rows, durable rule when eligible
   *  (the card copy is the consent — DECISIONS #143). */
  function fileGroup(group: TriageGroupView, categoryId: string, via: string, displayName?: string) {
    const catName = displayName ?? nameOf(categoryId);
    logInteraction(via, `file-group ${group.merchantCanonical} ×${group.count} → ${catName}`);
    const rollback = groups;
    advanceGroup();
    runAction(rollback, async () => {
      const result = await fileMerchantGroup({
        anchorTransactionId: group.anchorTransactionId,
        categoryId,
      });
      if (result.correctionIds.length === 0) return; // raced another session
      setUndoStack((s) => [
        ...s,
        {
          kind: 'corrections',
          correctionIds: result.correctionIds,
          label: `${result.affected} × ${group.merchantCanonical}`,
        },
      ]);
    });
  }

  /** Drain the pile: file EVERY confident group (one that has an honest,
   *  unanimous suggestion) to its own suggestion in one undoable action; the
   *  ambiguous groups stay for manual review (DECISIONS #162). Optimistically
   *  keeps only the ambiguous groups, then reconciles with the authoritative
   *  queue the action returns (partial failures reappear there). */
  function acceptAllConfidentGroups() {
    if (pending) return;
    const { merchants, transactions } = summarizeConfident(groups);
    if (merchants < 2) return; // one confident group is just one swipe — no bulk action
    logInteraction('tap', `accept-all ${merchants} merchants ×${transactions}`);
    const rollback = groups;
    setGroups(groups.filter((g) => !isConfidentGroup(g))); // optimistic: keep the ambiguous
    resetTransient();
    runAction(rollback, async () => {
      const result = await acceptAllConfident();
      setGroups(result.groups); // authoritative remaining queue (any failed group reappears)
      // Hand focus to the (aria-live) count so it never falls to <body> when the
      // banner unmounts; the count also announces the new pile size.
      countRef.current?.focus();
      if (result.correctionIds.length > 0) {
        setUndoStack((s) => [
          ...s,
          {
            kind: 'corrections',
            correctionIds: result.correctionIds,
            label: `${result.affected} ${result.affected === 1 ? 'transaction' : 'transactions'} in ${result.merchantsFiled} ${result.merchantsFiled === 1 ? 'merchant' : 'merchants'}`,
          },
        ]);
      }
    });
  }

  /** File ONE row (singles drill-down). Keeps the classic one-tap rule prompt. */
  function fileRow(group: TriageGroupView, row: GroupRow, categoryId: string, via: string, displayName?: string) {
    const catName = displayName ?? nameOf(categoryId);
    logInteraction(via, `file-row ${group.merchantCanonical} ${row.id} → ${catName}`);
    const rollback = groups;
    removeRowLocally(row.id);
    runAction(rollback, async () => {
      const result = await applyCategory({ transactionId: row.id, categoryId });
      setUndoStack((s) => [
        ...s,
        { kind: 'corrections', correctionIds: result.correctionIds, label: group.merchantCanonical },
      ]);
      if (group.ruleEligible) {
        setRulePrompt({
          correctionId: result.correctionIds[0],
          merchant: group.merchantCanonical,
          categoryName: catName,
        });
      }
    });
  }

  function removeRowLocally(rowId: string) {
    // Filing the LAST row of a group must not leak singles mode onto the NEXT
    // merchant's card (checker P1). Derive "emptied" BEFORE dispatch from the
    // same committed state the rollback snapshots use — a flag mutated INSIDE
    // the setGroups updater is only observable when React evaluates the updater
    // eagerly, which it skips whenever the fiber already has pending updates:
    // deterministically so on the write-in path, where createAndFile dispatches
    // setExtraCategories/setNewCatName before onPick→fileRow lands here, so the
    // singles reset silently no-oped (cycle-2 P1). Discrete events each flush
    // their own render, so `groups` is current at handler time.
    const target = groups.find((g) => g.rows.some((r) => r.id === rowId));
    const groupEmptied = target !== undefined && target.rows.length === 1;
    setGroups((gs) =>
      gs
        .map((g) => {
          if (!g.rows.some((r) => r.id === rowId)) return g;
          const rows = g.rows.filter((r) => r.id !== rowId);
          const removed = g.rows.find((r) => r.id === rowId)!;
          return {
            ...g,
            rows,
            count: rows.length,
            totalCents: g.totalCents - removed.amountCents,
            anchorTransactionId: rows[0]?.id ?? g.anchorTransactionId,
          };
        })
        .filter((g) => g.rows.length > 0),
    );
    if (groupEmptied) setMode('idle');
    setActiveRowId(null);
    setSinglesTool(null);
    setNewCatOpen(false);
    setNewCatError(null);
    setCatQuery('');
  }

  /** Write-in flow (#136/#139): create the custom category, THEN file — the
   *  target is whatever the open picker targets (group or single row). */
  function createAndFile(onPick: (categoryId: string, displayName: string) => void) {
    const trimmed = newCatName.trim().replace(/\s+/g, ' ');
    if (!trimmed || pending) return;
    setNewCatError(null);
    logInteraction('tap', `new-category ${trimmed}`);
    startTransition(async () => {
      let res;
      try {
        res = await createCustomCategory({
          name: trimmed,
          group: newCatGroup,
          discretionary: newCatDiscretionary,
        });
      } catch {
        // Degrade to the inline-error contract — never the route error boundary (critic P1).
        setNewCatError('Could not create that category — nothing was saved. Try again.');
        return;
      }
      if (!res.ok || !res.id) {
        setNewCatError(res.error ?? 'Could not create that category.');
        return;
      }
      const id = res.id;
      setExtraCategories((xs) => [...xs, { id, name: trimmed, group: newCatGroup }]);
      setNewCatName('');
      onPick(id, trimmed);
    });
  }

  /** Open the write-in prefilled from the live query (#139) + suggestion group. */
  function openNewCategory(suggestedCategoryId: string | null) {
    logInteraction('tap', 'new-category-form');
    const suggestedGroup = suggestedCategoryId
      ? allCats.find((c) => c.id === suggestedCategoryId)?.group
      : undefined;
    setNewCatGroup(
      suggestedGroup && CUSTOM_CATEGORY_GROUPS.includes(suggestedGroup)
        ? suggestedGroup
        : (CUSTOM_CATEGORY_GROUPS[0] ?? ''),
    );
    setNewCatName(catQuery.trim());
    setNewCatDiscretionary(true);
    setNewCatError(null);
    setNewCatOpen(true);
  }

  function doSplit(group: TriageGroupView, row: GroupRow, firstCents: number, catA: string, catB: string) {
    logInteraction('tap', `split ${group.merchantCanonical}`);
    const rollback = groups;
    removeRowLocally(row.id);
    setMode(group.count > 1 ? 'singles' : 'idle');
    runAction(rollback, async () => {
      const sign = row.amountCents < 0 ? -1 : 1;
      const a = sign * Math.abs(firstCents);
      const b = row.amountCents - a;
      await splitTransaction({
        transactionId: row.id,
        parts: [
          { amountCents: a, categoryId: catA },
          { amountCents: b, categoryId: catB },
        ],
      });
      setUndoStack((s) => [...s, { kind: 'split', transactionId: row.id, label: `split ${group.merchantCanonical}` }]);
    });
  }

  function undoLast() {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    logInteraction('tap', `undo ${last.label}`);
    setUndoStack((s) => s.slice(0, -1));
    setRulePrompt(null);
    setError(null);
    startTransition(async () => {
      try {
        const fresh =
          last.kind === 'corrections'
            ? await undoCorrections(last.correctionIds)
            : await undoSplit(last.transactionId);
        setGroups(fresh);
        resetTransient();
      } catch (e) {
        setUndoStack((s) => [...s, last]); // the undo opportunity must not vanish
        setError(e instanceof Error ? e.message : 'Undo failed — nothing was changed.');
      }
    });
  }

  // ── swipe + long-press gestures (group card) ──
  function onPointerDown(e: React.PointerEvent) {
    dragStart.current = e.clientX;
    longPress.current = setTimeout(() => {
      if (!top) return;
      logInteraction('longpress', top.count > 1 ? 'singles-mode' : 'split-mode');
      setMode(top.count > 1 ? 'singles' : 'split');
      dragStart.current = null;
    }, 500);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (dragStart.current === null) return;
    const dx = e.clientX - dragStart.current;
    if (Math.abs(dx) > 8 && longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
    setDragX(dx);
  }
  function onPointerUp() {
    if (longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
    if (dragStart.current === null) return;
    dragStart.current = null;
    if (!top) return;
    if (dragX > 70) {
      if (pending || !top.suggestedCategoryId) {
        setDragX(0); // snap back: mid-action, or nothing honest to accept
        return;
      }
      logInteraction('swipe', 'right');
      fileGroup(top, top.suggestedCategoryId, 'swipe');
    } else if (dragX < -70) {
      logInteraction('swipe', 'left → picker');
      setMode('picker');
      setDragX(0);
    } else {
      setDragX(0);
    }
  }

  // Rendered in BOTH the queue view and the empty state (cycle-1 H5).
  function renderRulePrompt() {
    if (!rulePrompt) return null;
    return (
      <div
        className="space-y-1 rounded-lg border bg-accent/40 px-3 py-2 text-left text-sm"
        data-testid="rule-prompt"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Always file <b>{rulePrompt.merchant}</b> under <b>{rulePrompt.categoryName}</b>?
          </span>
          <span className="flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              data-testid="rule-always"
              onClick={() => {
                logInteraction('tap', `always-rule ${rulePrompt.merchant}`);
                const id = rulePrompt.correctionId;
                setRulePrompt(null);
                startTransition(async () => {
                  try {
                    await makeRuleFromCorrection(id);
                  } catch (e) {
                    // A failed "Always" degrades to the inline error — never the route
                    // error boundary, which would wipe the queue position (checker P2).
                    setError(e instanceof Error ? e.message : 'Could not create the rule.');
                  }
                });
              }}
            >
              Always
            </Button>
            <Button size="sm" variant="ghost" data-testid="rule-once" onClick={() => setRulePrompt(null)}>
              Just this once
            </Button>
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          “Always” files future {rulePrompt.merchant} charges as {rulePrompt.categoryName}{' '}
          automatically — they skip review. Undo removes the rule.
        </p>
      </div>
    );
  }

  /** The shared searchable picker + write-in (#137/#139), targeting `onPick`. */
  function renderPicker(
    quickPickIds: string[],
    quickPickNames: string[],
    suggestedCategoryId: string | null,
    onPick: (categoryId: string, displayName?: string) => void,
    footer: string | null,
  ) {
    const visibleCatGroups = filterCategoryOptions(categoryGroups, catQuery);
    const onlyVisibleCat =
      visibleCatGroups.length === 1 && visibleCatGroups[0].items.length === 1
        ? visibleCatGroups[0].items[0]
        : null;
    return (
      <div
        className="space-y-2 outline-none"
        ref={pickerPanelRef}
        tabIndex={-1}
        role="region"
        aria-label="Pick a category"
        data-testid="triage-alternatives-panel"
      >
        <div className="grid grid-cols-3 gap-2" data-testid="triage-alternatives">
          {quickPickIds.map((id, i) => (
            <Button key={id} variant="outline" size="sm" disabled={pending} onClick={() => onPick(id)}>
              {quickPickNames[i]}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <label htmlFor="triage-cat-search" className="text-xs text-muted-foreground">
            Or search all {allCats.length} categories:
          </label>
          <input
            id="triage-cat-search"
            type="search"
            value={catQuery}
            onChange={(e) => setCatQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (e.repeat) return; // held-key auto-repeat never drives actions (checker P1)
                if (onlyVisibleCat && !pending) onPick(onlyVisibleCat.id);
                else if (visibleCatGroups.length === 0 && catQuery.trim() && !pending && !newCatOpen)
                  openNewCategory(suggestedCategoryId);
              } else if (e.key === 'Escape') {
                if (catQuery) setCatQuery('');
                else {
                  setMode((m) => (m === 'picker' ? 'idle' : m));
                  setSinglesTool(null);
                }
              }
            }}
            placeholder="Search categories…"
            data-testid="triage-cat-search"
            disabled={pending}
            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          />
          {/* role=listbox/option + aria-selected — SR parity with the register's category menu
              (transaction-list.tsx; the shared-CategoryPicker follow-up). The search input sits
              OUTSIDE this container, so the listbox holds only options + group labels. */}
          <div
            data-testid="triage-all-categories"
            role="listbox"
            aria-label="All categories"
            className="max-h-56 overflow-auto rounded-md border p-1"
          >
            {filterCategoryOptions(categoryGroups, catQuery).map((g) => (
              <div key={g.group}>
                <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.group}
                </div>
                {g.items.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={c.id === suggestedCategoryId}
                    data-testid="triage-cat-option"
                    data-cat={c.id}
                    disabled={pending}
                    className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                    onClick={() => onPick(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            ))}
            {filterCategoryOptions(categoryGroups, catQuery).length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground" data-testid="triage-cat-no-match">
                No matching category — create it below.
              </p>
            )}
          </div>
        </div>
        {!newCatOpen ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => openNewCategory(suggestedCategoryId)}
            data-testid="triage-add-category"
            className="gap-1 text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" aria-hidden /> New category
          </Button>
        ) : (
          <div className="space-y-2 rounded-lg border p-3" data-testid="triage-new-category">
            <p className="text-sm font-medium">New category — filed right away</p>
            {newCatError && (
              <p role="alert" className="text-xs text-red-400" data-testid="new-category-error">
                {newCatError}
              </p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Name
                <input
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => {
                    // isComposing: IME commit must not submit (critic P2). e.repeat:
                    // a held Enter must not create+file (checker P1).
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.repeat) {
                      e.preventDefault();
                      createAndFile(onPick);
                    } else if (e.key === 'Escape') {
                      setNewCatOpen(false);
                      setNewCatError(null);
                    }
                  }}
                  placeholder="e.g. Golf"
                  aria-label="New category name"
                  data-testid="new-category-name"
                  className="h-9 w-40 rounded-md border bg-background px-2 text-sm"
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Group
                <select
                  value={newCatGroup}
                  onChange={(e) => setNewCatGroup(e.target.value)}
                  aria-label="Group for the new category"
                  data-testid="new-category-group"
                  className="h-9 w-44 rounded-md border bg-background px-2 text-sm"
                >
                  {CUSTOM_CATEGORY_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 pb-2.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={newCatDiscretionary}
                  onChange={(e) => setNewCatDiscretionary(e.target.checked)}
                  data-testid="new-category-discretionary"
                />
                Discretionary
              </label>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={pending || !newCatName.trim()}
                data-testid="new-category-submit"
                onClick={() => createAndFile(onPick)}
              >
                Create &amp; file
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNewCatOpen(false);
                  setNewCatError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {footer && <p className="text-xs text-muted-foreground">{footer}</p>}
      </div>
    );
  }

  /** Split editor for one row (both categories selectable — group suggestions
   *  are often absent, so part A can't silently assume one). */
  function renderSplit(group: TriageGroupView, row: GroupRow) {
    const splitTotal = Math.abs(row.amountCents);
    const defaultFirst = group.suggestedCategoryId ?? allCats.find((c) => c.id === 'shopping')?.id ?? allCats[0]?.id ?? '';
    const firstCatId = splitFirstCat || defaultFirst;
    const defaultSecondCatId =
      allCats.find((c) => c.id === 'shopping' && c.id !== firstCatId)?.id ??
      allCats.find((c) => c.id !== firstCatId)?.id ??
      allCats[0]?.id ??
      '';
    const secondCatId = splitSecondCat || defaultSecondCatId;
    let splitFirstCents: number | null = null;
    try {
      splitFirstCents = splitFirstHalf.trim() === '' ? null : centsFromDollarString(splitFirstHalf.trim());
    } catch {
      splitFirstCents = null;
    }
    const splitValid = splitFirstCents !== null && splitFirstCents > 0 && splitFirstCents < splitTotal;
    const splitSecondCents = splitValid ? splitTotal - (splitFirstCents as number) : null;
    return (
      <div className="space-y-2 rounded-lg border p-3" data-testid="triage-split">
        <p className="text-sm font-medium">Split {formatCents(cents(row.amountCents))} into two categories</p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="split-amount" className="text-xs text-muted-foreground">
            First part $
          </label>
          <input
            id="split-amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
            value={splitFirstHalf}
            onChange={(e) => setSplitFirstHalf(e.target.value)}
            data-testid="split-amount"
          />
          <label htmlFor="split-first-cat" className="sr-only">
            First part category
          </label>
          <select
            id="split-first-cat"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={firstCatId}
            onChange={(e) => setSplitFirstCat(e.target.value)}
            data-testid="split-first-cat"
          >
            {allCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">· rest →</span>
          <label htmlFor="split-second-cat" className="sr-only">
            Second part category
          </label>
          <select
            id="split-second-cat"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={secondCatId}
            onChange={(e) => setSplitSecondCat(e.target.value)}
            data-testid="split-second-cat"
          >
            {allCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs" data-testid="split-preview">
          {splitValid ? (
            <span className="text-muted-foreground tabular-nums">
              <b className="text-foreground">{nameOf(firstCatId)}</b> {formatCents(cents(splitFirstCents as number))}
              {'   +   '}
              <b className="text-foreground">{nameOf(secondCatId)}</b> {formatCents(cents(splitSecondCents as number))}
            </span>
          ) : (
            <span className="text-muted-foreground">
              Enter a first part between {formatCents(cents(1))} and {formatCents(cents(splitTotal - 1))} — the rest
              goes to the second category.
            </span>
          )}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={pending || !splitValid}
            data-testid="split-confirm"
            onClick={() => {
              let v: number;
              try {
                v = centsFromDollarString(splitFirstHalf.trim());
              } catch {
                setError('Enter the first part as dollars and cents, e.g. 5.00.');
                return;
              }
              if (v > 0 && v < Math.abs(row.amountCents)) {
                doSplit(group, row, v, firstCatId, secondCatId);
              } else {
                setError('The first part must be more than $0 and less than the full amount.');
              }
            }}
          >
            Split
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSinglesTool(null);
              setMode((m) => (m === 'split' ? 'idle' : m));
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (!top) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center" data-testid="triage-empty">
        <p className="flex items-center justify-center gap-2 text-lg font-medium">
          <PartyPopper className="size-5 text-emerald-500" aria-hidden /> Inbox zero
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing needs review. High-confidence transactions are filed automatically — the Inbox tab
          will show a badge when something needs you.
        </p>
        <div className="mt-3">{renderRulePrompt()}</div>
        {undoStack.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={undoLast}
            disabled={pending} // a double-tap must not undo TWO decisions (checker P1)
            data-testid="triage-undo"
          >
            Undo last ({undoStack[undoStack.length - 1].label})
          </Button>
        )}
      </div>
    );
  }

  const one = top.count === 1;
  const anchorRow = top.rows[0];
  const confidentSummary = summarizeConfident(groups);
  const activeRow = activeRowId ? top.rows.find((r) => r.id === activeRowId) : null;
  const groupFooter = top.ruleEligible
    ? `Files ${one ? 'it' : `all ${top.count}`} and every future ${top.merchantCanonical} automatically. Undo reverses everything.`
    : one
      ? 'Files this payment. Undo reverses it.'
      : `Files all ${top.count} identical payments. Undo reverses everything.`;

  return (
    <div className="space-y-3" data-testid="triage-inbox" data-remaining={groups.length}>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-300"
          data-testid="triage-error"
        >
          {error} Your queue was restored.
        </div>
      )}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span data-testid="triage-count" aria-live="polite" tabIndex={-1} ref={countRef} className="outline-none">
          {groups.length === 1 ? '1 merchant left' : `${groups.length} merchants left`}
          {groups.length > PASS_SIZE && ` · first ${PASS_SIZE} this pass`}
        </span>
        {undoStack.length > 0 && (
          <Button variant="ghost" size="sm" onClick={undoLast} disabled={pending} data-testid="triage-undo">
            ↩ Undo
          </Button>
        )}
      </div>

      {/* Drain accelerant (DECISIONS #162): file every group I'm confident about
          in one undoable tap; you review only the ambiguous rest. Shown only when
          it beats swiping (≥2 confident groups) AND you're not mid-pick on a card —
          so it never silently discards an in-progress recategorization. */}
      {mode === 'idle' && confidentSummary.merchants >= 2 && (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border bg-accent/40 px-3 py-2"
          data-testid="triage-accept-all-banner"
        >
          <div>
            <p className="text-sm">
              <b>{confidentSummary.merchants} merchants</b> have a confident suggestion
              <span className="text-muted-foreground"> · {confidentSummary.transactions} transactions</span>
            </p>
            <p className="text-xs text-muted-foreground">The ambiguous rest stay for you to review.</p>
          </div>
          <Button
            size="sm"
            onClick={acceptAllConfidentGroups}
            disabled={pending}
            data-testid="triage-accept-all"
            aria-label={`Accept the suggested category for all ${confidentSummary.merchants} confident merchants (${confidentSummary.transactions} transactions). You review the rest.`}
          >
            Accept all {confidentSummary.merchants}
          </Button>
        </div>
      )}

      {renderRulePrompt()}

      <Card
        data-testid="triage-card"
        className="touch-pan-y select-none"
        style={{ transform: `translateX(${dragX}px) rotate(${dragX / 40}deg)`, transition: dragX === 0 ? 'transform 150ms' : 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <CardContent className="space-y-2 pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{top.merchantCanonical}</span>
            <span className="text-lg font-semibold tabular-nums">
              {formatCents(cents(top.totalCents), { signDisplay: 'always' })}
            </span>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="triage-group-meta">
            {one
              ? `1 transaction · ${formatISODate(isoDate(top.newestDate))} · ${anchorRow.accountName}`
              : `${top.count} transactions · ${formatISODate(isoDate(top.oldestDate))} – ${formatISODate(isoDate(top.newestDate))}`}
            {one && anchorRow.status === 'PENDING' && (
              <Badge variant="outline" className="ml-1">
                pending
              </Badge>
            )}
          </p>
          {top.variants.slice(0, 2).map((v) => (
            <p key={v} className="break-all font-mono text-xs text-muted-foreground">
              {v}
            </p>
          ))}
          {top.variants.length > 2 && (
            <p className="text-xs text-muted-foreground">+ {top.variants.length - 2} more descriptor variants</p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-sm text-muted-foreground">Suggestion:</span>
            {top.suggestedCategoryName ? (
              <Badge data-testid="triage-suggestion">{top.suggestedCategoryName}</Badge>
            ) : (
              <span className="text-sm text-muted-foreground" data-testid="triage-no-suggestion">
                none yet — pick once for {one ? 'this' : `all ${top.count}`}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {mode === 'picker' &&
        renderPicker(
          top.alternativeIds,
          top.alternativeNames,
          top.suggestedCategoryId,
          (id, name) => fileGroup(top, id, name ? 'new-category' : 'select', name),
          null, // the consent line below the action row is always visible — no duplicate
        )}

      {mode === 'split' && renderSplit(top, anchorRow)}

      {mode === 'singles' && (
        <div className="space-y-2 rounded-lg border p-2" data-testid="triage-singles">
          <p className="px-1 text-xs text-muted-foreground">
            One by one — pick or split individual {top.merchantCanonical} transactions:
          </p>
          {top.rows.map((r) => (
            <div key={r.id} className="rounded-md border px-2 py-1.5" data-testid="triage-single-row">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-xs text-muted-foreground">
                  {formatISODate(isoDate(r.date))} · {r.accountName}
                </span>
                <span className="tabular-nums">{formatCents(cents(r.amountCents), { signDisplay: 'always' })}</span>
              </div>
              <p className="break-all font-mono text-[10px] text-muted-foreground">{r.rawDescriptor}</p>
              <div className="mt-1 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  data-testid="single-pick"
                  onClick={() => {
                    setActiveRowId(activeRowId === r.id && singlesTool === 'pick' ? null : r.id);
                    setSinglesTool(activeRowId === r.id && singlesTool === 'pick' ? null : 'pick');
                    setCatQuery('');
                  }}
                >
                  Pick
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  data-testid="single-split"
                  onClick={() => {
                    setActiveRowId(activeRowId === r.id && singlesTool === 'split' ? null : r.id);
                    setSinglesTool(activeRowId === r.id && singlesTool === 'split' ? null : 'split');
                    setSplitFirstHalf('');
                  }}
                >
                  Split
                </Button>
              </div>
              {activeRow?.id === r.id && singlesTool === 'pick' && (
                <div className="mt-2">
                  {renderPicker(
                    top.alternativeIds,
                    top.alternativeNames,
                    top.suggestedCategoryId,
                    (id, name) => fileRow(top, r, id, name ? 'new-category' : 'select', name),
                    null,
                  )}
                </div>
              )}
              {activeRow?.id === r.id && singlesTool === 'split' && <div className="mt-2">{renderSplit(top, r)}</div>}
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
            Back to the group
          </Button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="outline"
          onClick={() => {
            logInteraction('tap', 'picker');
            setMode(mode === 'picker' ? 'idle' : 'picker');
          }}
          data-testid="triage-more"
        >
          ⋯ Pick
        </Button>
        <Button
          onClick={() => {
            if (top.suggestedCategoryId) fileGroup(top, top.suggestedCategoryId, 'tap');
            else {
              logInteraction('tap', 'picker (no suggestion)');
              setMode('picker');
            }
          }}
          disabled={pending}
          data-testid="triage-accept"
        >
          <span className="truncate">
            {top.suggestedCategoryId
              ? one
                ? `✓ File as ${top.suggestedCategoryName}`
                : `✓ File all ${top.count}`
              : one
                ? 'Pick category'
                : `Pick for all ${top.count}`}
          </span>
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            if (one) {
              logInteraction('tap', 'split-mode');
              setMode(mode === 'split' ? 'idle' : 'split');
            } else {
              logInteraction('tap', 'singles-mode');
              setMode(mode === 'singles' ? 'idle' : 'singles');
            }
          }}
          data-testid="triage-split-btn"
        >
          {one ? '⑂ Split' : '☰ One by one'}
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground" data-testid="triage-consent-line">
        {groupFooter}
      </p>

      <p className="text-center text-xs text-muted-foreground">
        Swipe right to file · swipe left to pick · long-press to {one ? 'split' : 'review one by one'}
      </p>
    </div>
  );
}
