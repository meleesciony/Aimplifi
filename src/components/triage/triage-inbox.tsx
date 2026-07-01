'use client';

/**
 * Triage inbox — built for thumbs (380px first).
 *  - swipe RIGHT (or ✓) = accept the AI suggestion
 *  - swipe LEFT (or ⋯) = pick from 3 smart alternatives
 *  - long-press (or ⑂) = split the transaction
 *  - "apply to all N similar" batches a merchant in one tap (exact-descriptor
 *    scope for aggregate pseudo-merchants like Zelle/checks — DECISIONS #23)
 *  - universal undo (inverse corrections; created rules removed)
 *  - every correction offers a one-tap durable rule ("Always / Just this once")
 *
 * Instrumentation: every user interaction appends to window.__triageLog so the
 * Phase 2 e2e can count interactions (<15) and map them to the documented
 * human-time budget (<60s). See tests/e2e/phase2-triage.spec.ts.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { PartyPopper, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatISODate, isoDate } from '@/lib/dates';
import { CUSTOM_CATEGORY_GROUPS } from '@/lib/engine/categorize/assign';
import { cents, centsFromDollarString, formatCents } from '@/lib/money';
import type { TriageItem } from '@/server/triage';
import { createCustomCategory } from '@/server/custom-category-actions';
import {
  applyCategory,
  applyToAllSimilar,
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

export function TriageInbox({
  initialItems,
  categories,
}: {
  initialItems: TriageItem[];
  categories: { id: string; name: string; group?: string }[];
}) {
  const [items, setItems] = useState(initialItems);
  const [mode, setMode] = useState<'idle' | 'alternatives' | 'split'>('idle');
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [rulePrompt, setRulePrompt] = useState<RulePrompt | null>(null);
  const [splitFirstHalf, setSplitFirstHalf] = useState<string>('');
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

  const top = items[0];
  // The overlay is a BRIDGE until the create action's revalidation refreshes the
  // `categories` prop (RSC payload). Once the server list carries an overlay id,
  // PRUNE it — from then on the server is authoritative, so a category deleted
  // in another tab can never be resurrected by a stale overlay entry (critic P2).
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

  // Full taxonomy grouped by parent, for the "any category" picker (the 3 quick
  // alternatives can't cover ~80 categories). Preserves CATEGORIES' declaration
  // order, which is already logically grouped.
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

  function advance() {
    setItems((xs) => xs.slice(1));
    setMode('idle');
    setDragX(0);
    setSplitFirstHalf('');
    setSplitSecondCat('');
    setNewCatOpen(false);
    setNewCatError(null);
  }

  /** Optimistic update with rollback: a failed action restores the queue and
   *  surfaces the error — a correction is never silently lost (critic F6). */
  function runAction(rollback: TriageItem[], fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        setItems(rollback);
        setMode('idle');
        setError(e instanceof Error ? e.message : 'Something went wrong — nothing was saved.');
      }
    });
  }

  function accept(item: TriageItem, categoryId: string, via: string, displayName?: string) {
    // A just-created category isn't in this render's `allCats` yet (state flushes
    // on the NEXT render) — the write-in flow passes the name it already knows.
    const catName = displayName ?? nameOf(categoryId);
    logInteraction(via, `accept ${item.merchantCanonical} → ${catName}`);
    const rollback = items;
    advance();
    runAction(rollback, async () => {
      const result = await applyCategory({ transactionId: item.id, categoryId });
      setUndoStack((s) => [
        ...s,
        { kind: 'corrections', correctionIds: result.correctionIds, label: item.merchantCanonical },
      ]);
      // never offer merchant-wide rules for aggregate merchants (Zelle/checks)
      if (item.ruleEligible) {
        setRulePrompt({
          correctionId: result.correctionIds[0],
          merchant: item.merchantCanonical,
          categoryName: catName,
        });
      }
    });
  }

  /** Write-in flow (#136): create the custom category, THEN file the current
   *  transaction under it — sequenced, because the id is only assignable once
   *  its row exists. Validation errors surface inline; nothing is filed. */
  function createAndFile(item: TriageItem) {
    // Same normalization the server persists (collapse internal whitespace), so
    // the overlay/pickers/rule-prompt can never disagree with the created row.
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
        // A rejected action (network flake, expired session) must degrade to the
        // component's inline-error contract — never the route error boundary,
        // which would wipe the queue position and undo stack (critic P1).
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
      accept(item, id, 'new-category', trimmed);
    });
  }

  /** Open the mini-form with the group prefilled from the current suggestion
   *  (customs may only join SPENDING groups — never Income/Transfers). */
  function openNewCategory(item: TriageItem) {
    logInteraction('tap', 'new-category-form');
    const suggestedGroup = allCats.find((c) => c.id === item.suggestedCategoryId)?.group;
    setNewCatGroup(
      suggestedGroup && CUSTOM_CATEGORY_GROUPS.includes(suggestedGroup)
        ? suggestedGroup
        : (CUSTOM_CATEGORY_GROUPS[0] ?? ''),
    );
    setNewCatDiscretionary(true);
    setNewCatError(null);
    setNewCatOpen(true);
  }

  function batchApply(item: TriageItem) {
    logInteraction('tap', `apply-to-all ${item.similarCount} ${item.merchantCanonical}`);
    const rollback = items;
    // optimistic removal mirrors the SERVER's batch scope exactly: exact
    // descriptor for aggregates, merchant otherwise (cycle-3 H2)
    setItems((xs) =>
      xs.filter((x) =>
        item.ruleEligible
          ? x.merchantId !== item.merchantId
          : x.rawDescriptor !== item.rawDescriptor,
      ),
    );
    setMode('idle');
    // The top card changes without advance() — close the write-in form so a
    // half-typed name + the PREVIOUS card's group prefill can never be filed
    // against the next card (critic P1).
    setNewCatOpen(false);
    setNewCatError(null);
    runAction(rollback, async () => {
      const result = await applyToAllSimilar({
        transactionId: item.id,
        categoryId: item.suggestedCategoryId,
      });
      if (result.correctionIds.length === 0) return; // nothing matched (raced another session)
      setUndoStack((s) => [
        ...s,
        {
          kind: 'corrections',
          correctionIds: result.correctionIds,
          label: `${result.affected} × ${item.merchantCanonical}`,
        },
      ]);
      // durable rules are ALWAYS consensual — same one-tap prompt as singles
      if (item.ruleEligible) {
        setRulePrompt({
          correctionId: result.correctionIds[0],
          merchant: item.merchantCanonical,
          categoryName: nameOf(item.suggestedCategoryId),
        });
      }
    });
  }

  function doSplit(item: TriageItem, firstCents: number, catA: string, catB: string) {
    logInteraction('tap', `split ${item.merchantCanonical}`);
    const rollback = items;
    advance();
    runAction(rollback, async () => {
      const sign = item.amountCents < 0 ? -1 : 1;
      const a = sign * Math.abs(firstCents);
      const b = item.amountCents - a;
      await splitTransaction({
        transactionId: item.id,
        parts: [
          { amountCents: a, categoryId: catA },
          { amountCents: b, categoryId: catB },
        ],
      });
      setUndoStack((s) => [...s, { kind: 'split', transactionId: item.id, label: `split ${item.merchantCanonical}` }]);
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
        setItems(fresh);
        setMode('idle');
        setDragX(0);
        // Undo replaces the top card without advance() — same stale-form
        // close as batchApply (critic P1).
        setNewCatOpen(false);
        setNewCatError(null);
      } catch (e) {
        // the undo opportunity must not silently vanish — restore it
        setUndoStack((s) => [...s, last]);
        setError(e instanceof Error ? e.message : 'Undo failed — nothing was changed.');
      }
    });
  }

  // ── swipe + long-press gesture handling ──
  function onPointerDown(e: React.PointerEvent) {
    dragStart.current = e.clientX;
    longPress.current = setTimeout(() => {
      logInteraction('longpress', 'split-mode');
      setMode('split');
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
      if (pending) {
        setDragX(0); // visible snap-back while the previous action lands — never a silent drop
        return;
      }
      logInteraction('swipe', 'right');
      accept(top, top.suggestedCategoryId, 'swipe');
    } else if (dragX < -70) {
      logInteraction('swipe', 'left → alternatives');
      setMode('alternatives');
      setDragX(0);
    } else {
      setDragX(0);
    }
  }

  // Rendered in BOTH the queue view and the empty state — accepting the LAST
  // item must still offer the one-tap durable rule (cycle-1 H5).
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
                  await makeRuleFromCorrection(id);
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

  if (!top) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center" data-testid="triage-empty">
        <p className="flex items-center justify-center gap-2 text-lg font-medium">
          <PartyPopper className="size-5 text-emerald-500" aria-hidden /> Inbox zero
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing needs review. High-confidence transactions are filed
          automatically — the Inbox tab will show a badge when something needs
          you.
        </p>
        <div className="mt-3">{renderRulePrompt()}</div>
        {undoStack.length > 0 && (
          <Button variant="outline" size="sm" className="mt-4" onClick={undoLast} data-testid="triage-undo">
            Undo last ({undoStack[undoStack.length - 1].label})
          </Button>
        )}
      </div>
    );
  }

  // ── live split preview (top is defined past the empty-state return above) ──
  const splitTotal = Math.abs(top.amountCents);
  const defaultSecondCatId =
    allCats.find((c) => c.id === 'shopping')?.id ??
    allCats.find((c) => c.id !== top.suggestedCategoryId)?.id ??
    allCats[0]?.id ??
    '';
  const secondCatId = splitSecondCat || defaultSecondCatId;
  let splitFirstCents: number | null = null;
  try {
    splitFirstCents =
      splitFirstHalf.trim() === '' ? null : centsFromDollarString(splitFirstHalf.trim());
  } catch {
    splitFirstCents = null;
  }
  const splitValid = splitFirstCents !== null && splitFirstCents > 0 && splitFirstCents < splitTotal;
  const splitSecondCents = splitValid ? splitTotal - (splitFirstCents as number) : null;

  return (
    <div className="space-y-3" data-testid="triage-inbox" data-remaining={items.length}>
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
        <span data-testid="triage-count">{items.length} to review</span>
        {undoStack.length > 0 && (
          <Button variant="ghost" size="sm" onClick={undoLast} disabled={pending} data-testid="triage-undo">
            ↩ Undo
          </Button>
        )}
      </div>

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
              {formatCents(cents(top.amountCents), { signDisplay: 'always' })}
            </span>
          </div>
          <p className="break-all font-mono text-xs text-muted-foreground">{top.rawDescriptor}</p>
          <p className="text-xs text-muted-foreground">
            {formatISODate(isoDate(top.date))} · {top.accountName}
            {top.status === 'PENDING' && (
              <Badge variant="outline" className="ml-1">
                pending
              </Badge>
            )}
          </p>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-sm text-muted-foreground">Suggestion:</span>
            <Badge data-testid="triage-suggestion">{top.suggestedCategoryName}</Badge>
          </div>
        </CardContent>
      </Card>

      {mode === 'alternatives' && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2" data-testid="triage-alternatives">
            {top.alternativeIds.map((id, i) => (
              <Button
                key={id}
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => accept(top, id, 'tap')}
              >
                {top.alternativeNames[i]}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="triage-all-cats" className="whitespace-nowrap text-xs text-muted-foreground">
              Or any category:
            </label>
            <select
              id="triage-all-cats"
              data-testid="triage-all-categories"
              disabled={pending}
              defaultValue=""
              className="w-full rounded-md border bg-background px-2 py-1 text-sm"
              onChange={(e) => {
                const id = e.target.value;
                if (id) accept(top, id, 'select');
              }}
            >
              <option value="" disabled>
                Pick from all {allCats.length} categories…
              </option>
              {categoryGroups.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          {!newCatOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => openNewCategory(top)}
              data-testid="triage-add-category"
              className="gap-1 text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3.5" aria-hidden /> New category
            </Button>
          ) : (
            <div className="space-y-2 rounded-lg border p-3" data-testid="triage-new-category">
              <p className="text-sm font-medium">
                New category — this transaction is filed under it right away
              </p>
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
                      // isComposing: Enter that commits an IME (CJK) composition
                      // must not submit the form (critic P2).
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        createAndFile(top);
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
                  onClick={() => createAndFile(top)}
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
        </div>
      )}

      {mode === 'split' && (
        <div className="space-y-2 rounded-lg border p-3" data-testid="triage-split">
          <p className="text-sm font-medium">Split {formatCents(cents(top.amountCents))} into two categories</p>
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
            <span className="text-xs text-muted-foreground">
              → {top.suggestedCategoryName} · rest →
            </span>
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
                <b className="text-foreground">{nameOf(top.suggestedCategoryId)}</b>{' '}
                {formatCents(cents(splitFirstCents as number))}
                {'   +   '}
                <b className="text-foreground">{nameOf(secondCatId)}</b>{' '}
                {formatCents(cents(splitSecondCents as number))}
              </span>
            ) : (
              <span className="text-muted-foreground">
                Enter a first part between {formatCents(cents(1))} and{' '}
                {formatCents(cents(splitTotal - 1))} — the rest goes to the second category.
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending || !splitValid}
              data-testid="split-confirm"
              onClick={() => {
                // splitValid already gates this button, but re-derive defensively so a
                // stale render can never persist an out-of-range or unparseable amount.
                let v: number;
                try {
                  v = centsFromDollarString(splitFirstHalf.trim());
                } catch {
                  setError('Enter the first part as dollars and cents, e.g. 5.00.');
                  return;
                }
                if (v > 0 && v < Math.abs(top.amountCents)) {
                  doSplit(top, v, top.suggestedCategoryId, secondCatId);
                } else {
                  setError('The first part must be more than $0 and less than the full amount.');
                }
              }}
            >
              Split
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="outline"
          onClick={() => {
            logInteraction('tap', 'alternatives');
            setMode(mode === 'alternatives' ? 'idle' : 'alternatives');
          }}
          data-testid="triage-more"
        >
          ⋯ Pick
        </Button>
        <Button
          onClick={() => accept(top, top.suggestedCategoryId, 'tap')}
          disabled={pending}
          data-testid="triage-accept"
        >
          ✓ Accept
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            logInteraction('tap', 'split-mode');
            setMode(mode === 'split' ? 'idle' : 'split');
          }}
          data-testid="triage-split-btn"
        >
          ⑂ Split
        </Button>
      </div>

      {top.similarCount > 1 && (
        <Button
          variant="secondary"
          className="w-full"
          disabled={pending}
          onClick={() => batchApply(top)}
          data-testid="triage-batch"
        >
          <span className="truncate">
            Apply “{top.suggestedCategoryName}” to all {top.similarCount}{' '}
            {top.ruleEligible ? `${top.merchantCanonical} items` : 'identical payments'}
          </span>
        </Button>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Swipe right to accept · swipe left for options · long-press to split
      </p>
    </div>
  );
}

