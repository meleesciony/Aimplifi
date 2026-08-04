'use client';

/**
 * Fixed / Discretionary control on a register row (DECISIONS #397).
 *
 * Deliberately NOT a native `<select>`: on touch devices globals.css floors
 * every `select` at 16px (iOS Safari zoom guard, DECISIONS #140), which made
 * this dial taller and louder than the Details / Rules chips beside it
 * (owner 2026-08-03). Same chip classes as those links; a tiny menu picks
 * the class. When the payee has more rows, the change asks first: just this
 * one, or all of them (#398).
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  spendClassLabel,
  type OutOfScopeReason,
  type SpendClass,
} from '@/lib/engine/spending-plan/spend-class';
import {
  setMerchantSpendClass,
  setTransactionSpendClass,
} from '@/server/transaction-flags-actions';
import { ROW_CHIP, SpendClassBadge } from '@/components/finance/spend-class-badge';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import { reloadPreservingScroll } from '@/components/finance/register-scroll';

/** Same chrome as Details / Rules on the register row — defined beside the badge
 *  so the two controls cannot drift apart in size. */
const CHIP = ROW_CHIP;

export function SpendClassSelect({
  transactionId,
  spendClass,
  reason,
  canEdit,
  merchantName,
  bulkCount,
}: {
  transactionId: string;
  spendClass: SpendClass;
  /** Why this row has no dial (`outOfScopeReason`), or null when it has one.
   *  Passed straight through to the badge — see its prop doc for why it is
   *  required rather than optional. */
  reason: OutOfScopeReason | null;
  canEdit: boolean;
  merchantName: string;
  /** How many transactions share this payee (the register's merchantCount
   *  basis). Undefined / ≤ 1 → no scope question, the write is single-row. */
  bulkCount?: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Menu open — picking Fixed vs Discretionary. */
  const [menuOpen, setMenuOpen] = useState(false);
  /** The class the reader picked, waiting on the scope answer. */
  const [choice, setChoice] = useState<'fixed' | 'guilt-free' | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);

  const editable = canEdit && spendClass !== 'out-of-scope';

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  if (!editable) {
    return <SpendClassBadge spendClass={spendClass} reason={reason} />;
  }

  const offersScope = typeof bulkCount === 'number' && bulkCount > 1;
  const currentLabel = spendClassLabel(spendClass === 'fixed' ? 'fixed' : 'guilt-free');

  function write(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      try {
        const res = await withDeadline(fn(), FORM_ACTION_DEADLINE_MS);
        if (!res.ok) {
          setError(res.error ?? 'Could not save — nothing was changed.');
          setChoice(null);
          return;
        }
        reloadPreservingScroll();
      } catch (err) {
        if (err instanceof ActionDeadline) {
          reloadPreservingScroll();
          return;
        }
        setError('Could not save — nothing was changed.');
        setChoice(null);
      }
    });
  }

  function pick(next: 'fixed' | 'guilt-free') {
    setMenuOpen(false);
    setError(null);
    if (next === spendClass) return;
    if (offersScope) {
      setChoice(next);
      return;
    }
    write(() => setTransactionSpendClass({ transactionId, spendClass: next }));
  }

  if (choice !== null) {
    const label = choice === 'fixed' ? 'Fixed' : 'Discretionary';
    return (
      <span
        className="flex min-w-0 flex-col gap-1 rounded border p-1.5"
        data-testid="txn-spend-class-scope"
      >
        <span className="text-[10px] text-muted-foreground">Make {label} for:</span>
        <button
          type="button"
          data-testid="txn-spend-class-scope-one"
          disabled={pending}
          className={CHIP}
          onClick={() =>
            write(() => setTransactionSpendClass({ transactionId, spendClass: choice }))
          }
        >
          Just this one
        </button>
        <button
          type="button"
          data-testid="txn-spend-class-scope-all"
          disabled={pending}
          className={CHIP}
          onClick={() =>
            write(() => setMerchantSpendClass({ transactionId, spendClass: choice }))
          }
        >
          All {bulkCount} {merchantName}
        </button>
        <button
          type="button"
          data-testid="txn-spend-class-scope-cancel"
          disabled={pending}
          className={`${CHIP} border-transparent`}
          onClick={() => setChoice(null)}
        >
          Cancel
        </button>
        {error ? (
          <span role="alert" className="text-[10px] text-red-400" data-testid="txn-spend-class-error">
            {error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="relative inline-flex min-w-0 flex-col" ref={rootRef}>
      <button
        type="button"
        data-testid="txn-spend-class"
        data-spend-class={spendClass}
        disabled={pending}
        title="Applies to this transaction — or every transaction from this payee, your choice"
        aria-label={`Fixed or discretionary for this ${merchantName} transaction. Currently ${currentLabel}.`}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        className={CHIP}
        onClick={() => setMenuOpen((o) => !o)}
      >
        {currentLabel}
      </button>
      {menuOpen ? (
        <div
          role="listbox"
          aria-label="Fixed or discretionary"
          className="absolute left-0 top-full z-20 mt-0.5 min-w-[7rem] rounded border bg-background p-0.5 shadow-md"
          data-testid="txn-spend-class-menu"
        >
          <button
            type="button"
            role="option"
            aria-selected={spendClass === 'fixed'}
            data-testid="txn-spend-class-fixed"
            className={`${CHIP} w-full justify-start border-transparent ${
              spendClass === 'fixed' ? 'bg-accent text-foreground' : ''
            }`}
            onClick={() => pick('fixed')}
          >
            Fixed
          </button>
          <button
            type="button"
            role="option"
            aria-selected={spendClass === 'guilt-free'}
            data-testid="txn-spend-class-guilt-free"
            className={`${CHIP} w-full justify-start border-transparent ${
              spendClass === 'guilt-free' ? 'bg-accent text-foreground' : ''
            }`}
            onClick={() => pick('guilt-free')}
          >
            Discretionary
          </button>
        </div>
      ) : null}
      {error ? (
        <span role="alert" className="text-[10px] text-red-400" data-testid="txn-spend-class-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
