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
 */
import Link from 'next/link';
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

export function TxnActionMenuItems({
  actions,
  excluded,
  busy,
  handlers,
}: {
  /** From `txnActionAvailability(facts)` — computed by the caller so server
   *  components can also precompute it if they ever need to. */
  actions: TxnActionAvailability[];
  /** The row's current exclusion, for the toggle's write direction. */
  excluded: boolean;
  busy: boolean;
  handlers: TxnActionHandlers;
}) {
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
        }
      })}
    </div>
  );
}
