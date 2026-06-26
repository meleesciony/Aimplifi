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
import { useMemo, useRef, useState, useTransition } from 'react';
import { PartyPopper } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents, centsFromDollarString, formatCents } from '@/lib/money';
import type { TriageItem } from '@/server/triage';
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

  const top = items[0];
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? id;

  // Full taxonomy grouped by parent, for the "any category" picker (the 3 quick
  // alternatives can't cover ~80 categories). Preserves CATEGORIES' declaration
  // order, which is already logically grouped.
  const categoryGroups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, { id: string; name: string }[]>();
    for (const c of categories) {
      const g = c.group ?? 'Other';
      if (!byGroup.has(g)) {
        byGroup.set(g, []);
        order.push(g);
      }
      byGroup.get(g)!.push({ id: c.id, name: c.name });
    }
    return order.map((g) => ({ group: g, items: byGroup.get(g)! }));
  }, [categories]);

  function advance() {
    setItems((xs) => xs.slice(1));
    setMode('idle');
    setDragX(0);
    setSplitFirstHalf('');
    setSplitSecondCat('');
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

  function accept(item: TriageItem, categoryId: string, via: string) {
    logInteraction(via, `accept ${item.merchantCanonical} → ${nameOf(categoryId)}`);
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
          categoryName: nameOf(categoryId),
        });
      }
    });
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
    categories.find((c) => c.id === 'shopping')?.id ??
    categories.find((c) => c.id !== top.suggestedCategoryId)?.id ??
    categories[0]?.id ??
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
                Pick from all {categories.length} categories…
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
              {categories.map((c) => (
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

