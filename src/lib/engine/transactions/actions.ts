/**
 * The one action menu (O.15 slice 2). Owner: "I should be able to do all other
 * features from one menu (tax related, reimburse, exclude from budget etc) —
 * even if I don't use it."
 *
 * This module is the SINGLE availability basis for that menu: every action is
 * always listed, and when one does not apply it is disabled with a one-line
 * reason — never hidden, because a control that vanishes with no sentence is
 * indistinguishable from one we forgot to build. The register menu, the detail
 * menu AND the server actions all read these rules from here, so a disabled
 * reason on screen and a refusal on the wire can never say different things.
 *
 * Pure: facts in, availability out. No I/O, no copy generated at runtime.
 */
import { reimbursementState } from '@/lib/engine/transactions/reimbursement';

/** The stored facts availability is decided on. All required — a forgotten
 *  field would silently ENABLE an action (the failure direction that moves
 *  money), so the compiler makes the caller supply each one. */
export interface ActionRowFacts {
  amountCents: number; // signed: outflow negative
  isTransfer: boolean;
  isSplitParent: boolean;
  splitParentId: string | null;
  taxClass: string | null;
  excludeFromTotals: boolean;
  reimbursement: string | null;
}

export type TxnActionKind =
  | 'category'
  | 'rule'
  | 'renamePayee'
  | 'note'
  | 'taxTag'
  | 'split'
  | 'reimbursement'
  | 'excludeFromTotals';

export interface TxnActionAvailability {
  kind: TxnActionKind;
  /** What the menu row says, in the row's current state. */
  label: string;
  enabled: boolean;
  /** The one-line reason when disabled; null when enabled. */
  reason: string | null;
  /** For 'reimbursement': the state the primary label writes. */
  nextReimbursement?: 'awaiting' | 'received' | null;
  /** For 'reimbursement' while awaiting: the escape hatch ("stop tracking"). */
  secondary?: { label: string; nextReimbursement: null };
}

// ── Shared refusal copy (imported by the server actions — one sentence each,
//    shown disabled in the menu and returned verbatim on a forced submit) ────

export const EXCLUDE_BLOCKED_SPLIT_PARENT =
  'A split container is already outside every total — exclude its pieces instead.';
export const EXCLUDE_BLOCKED_TRANSFER =
  'A transfer between your own accounts is already outside every total.';
export const REIMBURSE_BLOCKED_SPLIT_PARENT =
  'A split container does not carry money — track its pieces instead.';
export const REIMBURSE_BLOCKED_TRANSFER =
  'A transfer between your own accounts is not a purchase to be paid back for.';
export const REIMBURSE_BLOCKED_INFLOW =
  'This is money in — only a purchase can be awaiting reimbursement.';

// Existing copy, reused verbatim so the menu and the detail view's split
// section can never disagree (source: server/transactions.ts splitBlockedReason).
export const SPLIT_BLOCKED_CHILD =
  'This is already one piece of a split, and a piece cannot be split again.';
export const SPLIT_BLOCKED_TRANSFER =
  'This is a transfer between your own accounts, so its pieces would not count as spending anywhere. Splitting it would not change any total.';
export const SPLIT_BLOCKED_TOO_SMALL = 'This transaction is too small to split into two parts.';
// O.15 critic P1-2: a split turns this row into a container the outstanding-
// reimbursements line skips, so the money-owed claim would vanish with no event.
export const SPLIT_BLOCKED_REIMBURSED =
  'You are tracking a reimbursement on this transaction — stop tracking it first, then split.';
export const SPLIT_PARENT_HAS_UNDO =
  'You already split this — the pieces and the undo are on the details view.';

export const CATEGORY_BLOCKED_SPLIT_PARENT =
  'The pieces of this split carry the categories — file those instead.';
// Existing copy, reused verbatim (source: transaction-detail-view.tsx tax-on-parent).
export const TAX_BLOCKED_SPLIT_PARENT =
  'A tax tag belongs on the pieces, not on this container — the tax report leaves a split container out entirely, so a tag here would never reach it.';

/**
 * All eight actions, always, in menu order. The caller renders exactly this
 * list — adding an action means adding it here, where its availability rule
 * and its tests live.
 */
export function txnActionAvailability(t: ActionRowFacts): TxnActionAvailability[] {
  const reimb = reimbursementState(t.reimbursement);

  const category: TxnActionAvailability = t.isSplitParent
    ? { kind: 'category', label: 'Change category', enabled: false, reason: CATEGORY_BLOCKED_SPLIT_PARENT }
    : { kind: 'category', label: 'Change category', enabled: true, reason: null };

  // A rule is never blocked as a DESTINATION — /rules explains its own refusals
  // with the row in hand (`getRuleSourceTransaction.excludedReason` is "not a
  // refusal": the key still fills in). The menu link is therefore always live.
  const rule: TxnActionAvailability = {
    kind: 'rule',
    label: 'Create or edit a rule…',
    enabled: true,
    reason: null,
  };
  const renamePayee: TxnActionAvailability = {
    kind: 'renamePayee',
    label: 'Rename payee (via a rule)…',
    enabled: true,
    reason: null,
  };

  const note: TxnActionAvailability = { kind: 'note', label: 'Note', enabled: true, reason: null };

  const taxTag: TxnActionAvailability = t.isSplitParent
    ? { kind: 'taxTag', label: 'Tax tag', enabled: false, reason: TAX_BLOCKED_SPLIT_PARENT }
    : { kind: 'taxTag', label: 'Tax tag', enabled: true, reason: null };

  const split: TxnActionAvailability = t.isSplitParent
    ? { kind: 'split', label: 'Split…', enabled: false, reason: SPLIT_PARENT_HAS_UNDO }
    : t.splitParentId !== null
      ? { kind: 'split', label: 'Split…', enabled: false, reason: SPLIT_BLOCKED_CHILD }
      : t.isTransfer
        ? { kind: 'split', label: 'Split…', enabled: false, reason: SPLIT_BLOCKED_TRANSFER }
        : reimb !== null
          ? { kind: 'split', label: 'Split…', enabled: false, reason: SPLIT_BLOCKED_REIMBURSED }
          : Math.abs(t.amountCents) < 2
            ? { kind: 'split', label: 'Split…', enabled: false, reason: SPLIT_BLOCKED_TOO_SMALL }
            : { kind: 'split', label: 'Split…', enabled: true, reason: null };

  // O.15 critic P1-3: STARTING to track is refused on containers/transfers, but
  // STOPPING must always stay reachable — transfer detection can re-flag an
  // already-tracked row at any sync, and a menu that says "impossible" beside a
  // detail section offering the same action is two surfaces disagreeing on one
  // screen. The server enforces the same asymmetry (guards only when state ≠ null).
  const reimbursement: TxnActionAvailability =
    reimb !== null && (t.isSplitParent || t.isTransfer)
      ? {
          kind: 'reimbursement',
          label: 'Stop tracking reimbursement',
          enabled: true,
          reason: null,
          nextReimbursement: null,
        }
      : t.isSplitParent
    ? {
        kind: 'reimbursement',
        label: 'Awaiting reimbursement',
        enabled: false,
        reason: REIMBURSE_BLOCKED_SPLIT_PARENT,
      }
    : t.isTransfer
      ? {
          kind: 'reimbursement',
          label: 'Awaiting reimbursement',
          enabled: false,
          reason: REIMBURSE_BLOCKED_TRANSFER,
        }
      : reimb === null && t.amountCents >= 0
        ? {
            kind: 'reimbursement',
            label: 'Awaiting reimbursement',
            enabled: false,
            reason: REIMBURSE_BLOCKED_INFLOW,
          }
        : reimb === null
          ? {
              kind: 'reimbursement',
              label: 'Awaiting reimbursement',
              enabled: true,
              reason: null,
              nextReimbursement: 'awaiting',
            }
          : reimb === 'awaiting'
            ? {
                kind: 'reimbursement',
                label: 'Reimbursement received',
                enabled: true,
                reason: null,
                nextReimbursement: 'received',
                secondary: { label: 'Stop tracking reimbursement', nextReimbursement: null },
              }
            : {
                kind: 'reimbursement',
                label: 'Stop tracking reimbursement',
                enabled: true,
                reason: null,
                nextReimbursement: null,
              };

  // Same asymmetry as reimbursement (P1-3): EXCLUDING a transfer/container is
  // refused, but UN-excluding must stay reachable — transfer detection can
  // re-flag a row the reader excluded, and the undo may never be locked out.
  const exclude: TxnActionAvailability =
    t.excludeFromTotals && (t.isSplitParent || t.isTransfer)
      ? {
          kind: 'excludeFromTotals',
          label: 'Include in totals again',
          enabled: true,
          reason: null,
        }
      : t.isSplitParent
        ? {
            kind: 'excludeFromTotals',
            label: 'Exclude from totals',
            enabled: false,
            reason: EXCLUDE_BLOCKED_SPLIT_PARENT,
          }
        : t.isTransfer
          ? {
              kind: 'excludeFromTotals',
              label: 'Exclude from totals',
              enabled: false,
              reason: EXCLUDE_BLOCKED_TRANSFER,
            }
          : {
              kind: 'excludeFromTotals',
              label: t.excludeFromTotals ? 'Include in totals again' : 'Exclude from totals',
              enabled: true,
              reason: null,
            };

  return [category, rule, renamePayee, note, taxTag, split, reimbursement, exclude];
}
