'use client';

/**
 * The one action menu's CONTENT (O.15 slice 2) — every register row and the
 * detail view render this same list, so "what can I do to a transaction?" has
 * one answer everywhere. Owner: "I should be able to do all other features
 * from one menu (tax related, reimburse, exclude from budget etc) — even if I
 * don't use it."
 *
 * Deliberately content-only: the register keeps its single-open-row controller
 * (800+ rows must not each own hooks — see transaction-list.tsx's header), and
 * the detail view has its own busy/error discipline, so each surface supplies
 * the trigger, positioning and dismissal it already uses. What they may NOT
 * supply is the action list itself: that comes from `txnActionAvailability`
 * (src/lib/engine/transactions/actions.ts), where every disabled state carries
 * its one-line reason — an action that doesn't apply is shown disabled and
 * explained, never hidden.
 *
 * C.16 — the spend-class verb is the one action with a CONFIRM STEP inside the
 * menu. Tapping "Change spending class…" replaces the list with the
 * Fixed / Discretionary pick (the same two choices the old always-on register
 * dial offered, same testids), and a payee with more rows adds the same
 * scope question ("Make X for: Just this one / All N") the dial asked. The
 * write itself is the surface's (register: deadline + reload; detail: runFlag
 * + afterWriteHref) — passed in as `onSpendClass`, so the confirmation step
 * can live here once and obey each surface's write discipline. The step state
 * lives here because only ONE menu renders at a time (the register's
 * single-open controller, the detail page's own menu) — it never multiplies
 * per-row hooks.
 */
import Link from 'next/link';
import { useState } from 'react';
import type { TxnActionAvailability } from '@/lib/engine/transactions/actions';

export interface TxnActionHandlers {
  /** Open the category editor (register: the picker; detail: the form). */
  onCategory: () => void;
  /** Open the note + tax editor. Both kinds land here — one panel edits both. */
  onNoteTax: () => void;
  /** Start a split. Absent when the surface reaches split by NAVIGATION —
   *  `splitHref` renders instead (the register sends readers to the detail
   *  view, where the split form lives). */
  onSplit?: () => void;
  splitHref?: string;
  /** Write the reimbursement state ('awaiting' | 'received' | null). */
  onReimbursement: (state: 'awaiting' | 'received' | null) => void;
  /** Write the exclusion flag. */
  onExclude: (exclude: boolean) => void;
  /** Write the cleared/pending status by hand (O.13g). Only ever called for a
   *  row the reader entered — the engine disables it everywhere else. Absent when
   *  the surface reaches it by NAVIGATION (`statusHref`), which the register does:
   *  marking a row pending hides it from the tax export and five other surfaces,
   *  and that sentence only fits on the detail view. Same arrangement as `split`
   *  and `markRecurring`. */
  onStatus?: (next: 'PENDING' | 'POSTED') => void;
  statusHref?: string;
  /** C.16 — write the spend class after the in-menu confirm step. `all` true =
   *  every transaction from this payee (the "All N" scope choice); false = this
   *  row only. The surface's own write discipline (deadline/reload or
   *  runFlag/afterWriteHref) wraps the server action. */
  onSpendClass: (next: 'fixed' | 'guilt-free', all: boolean) => void;
  /** Destinations for the two rule-backed actions (pre-filled from this row). */
  ruleHref: string;
  renameHref: string;
  /** Open the recurring verdict (O.13f). Absent when the surface reaches it by
   *  NAVIGATION — `recurringHref` renders instead, the same split/detail-view
   *  arrangement, because the picker and the current verdict live on the detail
   *  page where the state is server-rendered. */
  onRecurring?: () => void;
  recurringHref?: string;
}

const ITEM_CLASS =
  'tap-target flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50';
const DISABLED_ITEM_CLASS =
  'flex w-full cursor-not-allowed items-center rounded px-2 py-1.5 text-left text-sm text-muted-foreground opacity-60';
const REASON_CLASS = 'px-2 pb-1.5 text-[11px] leading-snug text-muted-foreground';
const CHIP_ITEM_CLASS =
  'tap-target flex w-full items-center justify-start rounded border px-2 py-1.5 text-left text-sm hover:bg-accent';

export function TxnActionMenuItems({
  actions,
  excluded,
  busy,
  handlers,
  spendClassCurrent,
  spendClassBulkCount,
  spendClassMerchantName,
}: {
  /** From `txnActionAvailability(facts)` — computed by the caller so server
   *  components can also precompute it if they ever need to. */
  actions: TxnActionAvailability[];
  /** The row's current exclusion, for the toggle's write direction. */
  excluded: boolean;
  busy: boolean;
  handlers: TxnActionHandlers;
  /** C.16 — the row's derived class, for the pick step's selection marking and
   *  the no-op rule (tapping the class that is already in force does nothing,
   *  the same rule the old dial had). */
  spendClassCurrent: 'fixed' | 'guilt-free' | 'out-of-scope';
  /** C.16 — how many transactions share this payee (the register's merchantCount
   *  basis, the detail's spendClassSiblingCount). Undefined / ≤ 1 → no scope
   *  question, the write is single-row. */
  spendClassBulkCount?: number;
  /** C.16 — the payee's display name for the "All N <payee>" scope choice. */
  spendClassMerchantName: string;
}) {
  // C.16 — the in-menu confirm flow. One instance renders at a time (the
  // register's single-open controller, the detail page's own menu), and the
  // component REMOUNTS on every open (callers render it conditionally), so this
  // state can never leak across rows.
  const [spendClassStep, setSpendClassStep] = useState<'pick' | 'scope' | null>(null);
  const [spendClassChoice, setSpendClassChoice] = useState<'fixed' | 'guilt-free' | null>(null);

  function pickSpendClass(next: 'fixed' | 'guilt-free') {
    // Same no-op rule as the old dial: a tap that does not change anything
    // closes the flow instead of writing the same value back.
    if (next === spendClassCurrent) {
      setSpendClassStep(null);
      return;
    }
    if (typeof spendClassBulkCount === 'number' && spendClassBulkCount > 1) {
      setSpendClassChoice(next);
      setSpendClassStep('scope');
      return;
    }
    setSpendClassStep(null);
    handlers.onSpendClass(next, false);
  }

  // The confirm steps replace the whole list — the reader is now answering a
  // question about one action, not choosing an action.
  if (spendClassStep !== null) {
    if (spendClassStep === 'scope' && spendClassChoice !== null) {
      const label = spendClassChoice === 'fixed' ? 'Fixed' : 'Discretionary';
      return (
        <div
          role="menu"
          aria-label="Transaction actions"
          data-testid="txn-spend-class-scope"
          className="p-1"
        >
          <p className="px-2 pb-1 text-[10px] text-muted-foreground">Make {label} for:</p>
          <button
            type="button"
            role="menuitem"
            data-testid="txn-spend-class-scope-one"
            disabled={busy}
            className={ITEM_CLASS}
            onClick={() => handlers.onSpendClass(spendClassChoice, false)}
          >
            Just this one
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="txn-spend-class-scope-all"
            disabled={busy}
            className={ITEM_CLASS}
            onClick={() => handlers.onSpendClass(spendClassChoice, true)}
          >
            All {spendClassBulkCount} {spendClassMerchantName}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="txn-spend-class-scope-cancel"
            disabled={busy}
            className={`${ITEM_CLASS} text-xs text-muted-foreground`}
            onClick={() => setSpendClassStep('pick')}
          >
            Cancel
          </button>
        </div>
      );
    }
    return (
      <div role="menu" aria-label="Transaction actions" data-testid="txn-action-menu" className="p-1">
        <button
          type="button"
          role="menuitemradio"
          data-testid="txn-spend-class-fixed"
          aria-checked={spendClassCurrent === 'fixed'}
          className={`${CHIP_ITEM_CLASS} border-transparent ${
            spendClassCurrent === 'fixed' ? 'bg-accent text-foreground' : ''
          }`}
          onClick={() => pickSpendClass('fixed')}
        >
          Fixed
        </button>
        <button
          type="button"
          role="menuitemradio"
          data-testid="txn-spend-class-guilt-free"
          aria-checked={spendClassCurrent === 'guilt-free'}
          className={`${CHIP_ITEM_CLASS} border-transparent ${
            spendClassCurrent === 'guilt-free' ? 'bg-accent text-foreground' : ''
          }`}
          onClick={() => pickSpendClass('guilt-free')}
        >
          Discretionary
        </button>
        <button
          type="button"
          role="menuitem"
          data-testid="txn-spend-class-pick-cancel"
          className={`${ITEM_CLASS} text-xs text-muted-foreground`}
          onClick={() => setSpendClassStep(null)}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div role="menu" aria-label="Transaction actions" data-testid="txn-action-menu" className="p-1">
      {actions.map((a) => {
        const testid = `txn-action-${a.kind}`;
        if (!a.enabled) {
          return (
            <div key={a.kind}>
              {/* Disabled-with-reason, never hidden: the sentence is the feature. */}
              <button type="button" disabled aria-disabled data-testid={testid} className={DISABLED_ITEM_CLASS}>
                {a.label}
              </button>
              <p data-testid={`${testid}-reason`} className={REASON_CLASS}>
                {a.reason}
              </p>
            </div>
          );
        }
        switch (a.kind) {
          case 'rule':
            return (
              <Link key={a.kind} role="menuitem" href={handlers.ruleHref} prefetch={false} data-testid={testid} className={ITEM_CLASS}>
                {a.label}
              </Link>
            );
          case 'renamePayee':
            return (
              <Link key={a.kind} role="menuitem" href={handlers.renameHref} prefetch={false} data-testid={testid} className={ITEM_CLASS}>
                {a.label}
              </Link>
            );
          case 'split':
            return handlers.splitHref ? (
              <Link key={a.kind} role="menuitem" href={handlers.splitHref} prefetch={false} data-testid={testid} className={ITEM_CLASS}>
                {a.label}
              </Link>
            ) : (
              <button key={a.kind} type="button" role="menuitem" data-testid={testid} disabled={busy} className={ITEM_CLASS} onClick={handlers.onSplit}>
                {a.label}
              </button>
            );
          case 'markRecurring':
            return handlers.recurringHref ? (
              <Link key={a.kind} role="menuitem" href={handlers.recurringHref} prefetch={false} data-testid={testid} className={ITEM_CLASS}>
                {a.label}
              </Link>
            ) : (
              <button key={a.kind} type="button" role="menuitem" data-testid={testid} disabled={busy} className={ITEM_CLASS} onClick={handlers.onRecurring}>
                {a.label}
              </button>
            );
          case 'category':
            return (
              <button key={a.kind} type="button" role="menuitem" data-testid={testid} disabled={busy} className={ITEM_CLASS} onClick={handlers.onCategory}>
                {a.label}
              </button>
            );
          // C.16 — the verb opens the in-menu confirm flow (the pick step above).
          case 'spendClass':
            return (
              <button
                key={a.kind}
                type="button"
                role="menuitem"
                data-testid={testid}
                disabled={busy}
                className={ITEM_CLASS}
                onClick={() => setSpendClassStep('pick')}
              >
                {a.label}
              </button>
            );
          case 'note':
          case 'taxTag':
            return (
              <button key={a.kind} type="button" role="menuitem" data-testid={testid} disabled={busy} className={ITEM_CLASS} onClick={handlers.onNoteTax}>
                {a.label}
              </button>
            );
          case 'reimbursement':
            return (
              <div key={a.kind}>
                <button
                  type="button"
                  role="menuitem"
                  data-testid={testid}
                  disabled={busy}
                  className={ITEM_CLASS}
                  onClick={() => handlers.onReimbursement(a.nextReimbursement ?? null)}
                >
                  {a.label}
                </button>
                {a.secondary && (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`${testid}-secondary`}
                    disabled={busy}
                    className={`${ITEM_CLASS} text-xs text-muted-foreground`}
                    onClick={() => handlers.onReimbursement(a.secondary?.nextReimbursement ?? null)}
                  >
                    {a.secondary.label}
                  </button>
                )}
              </div>
            );
          case 'excludeFromTotals':
            return (
              <button
                key={a.kind}
                type="button"
                role="menuitem"
                data-testid={testid}
                disabled={busy}
                className={ITEM_CLASS}
                onClick={() => handlers.onExclude(!excluded)}
              >
                {a.label}
              </button>
            );
          case 'status':
            // The register NAVIGATES (statusHref): this action hides a row from
            // the tax export and five other surfaces, and the sentence that says
            // so lives beside the control on the detail view. A bare button here
            // would let a reader drop a tax-tagged row out of a preparer-bound
            // total in one click with nothing on screen — found independently by
            // both critics.
            return handlers.statusHref ? (
              <Link key={a.kind} role="menuitem" href={handlers.statusHref} prefetch={false} data-testid={testid} className={ITEM_CLASS}>
                {a.label}
              </Link>
            ) : (
              <button
                key={a.kind}
                type="button"
                role="menuitem"
                data-testid={testid}
                disabled={busy}
                className={ITEM_CLASS}
                onClick={() => handlers.onStatus?.(a.nextStatus ?? 'POSTED')}
              >
                {a.label}
              </button>
            );
        }
      })}
    </div>
  );
}
