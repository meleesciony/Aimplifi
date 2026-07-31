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
import type { RowOrigin } from '@/lib/engine/transactions/origin';

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
  /** 'PENDING' | 'POSTED' — the stored value, narrowed nowhere else. */
  status: string;
  /** Who owns the row (`rowOrigin`). Decides whether `status` is the reader's to write. */
  descriptorOrigin: RowOrigin;
}

export type TxnActionKind =
  | 'category'
  | 'rule'
  | 'renamePayee'
  | 'note'
  | 'taxTag'
  | 'split'
  | 'reimbursement'
  | 'excludeFromTotals'
  | 'markRecurring'
  | 'status';

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
  /** For 'status': the value the label writes. */
  nextStatus?: 'PENDING' | 'POSTED';
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

// O.13f. The label carries NO state ("Recurring…", not "Recurring: monthly"):
// this menu is rendered from row facts that do not include the reader's verdict,
// and a label claiming a state it cannot see would be wrong on exactly the rows
// he has already acted on. The destination shows what is actually in force.
export const RECURRING_BLOCKED_SPLIT_PARENT =
  'A split container is left out of every total, so there is no charge here to repeat — mark one of its pieces.';
export const RECURRING_BLOCKED_TRANSFER =
  'Aimplifi reads this as a move between your own accounts, and those are never tracked as bills.';

// ── O.13g / O.15 slice 7: Pending ⇄ Cleared by hand ─────────────────────────
//
// `status` is not like the other flags here. `excludeFromTotals` and
// `reimbursement` are READER-OWNED columns nothing else writes, so slice 2's rule
// ("starting an action may be refused; stopping it never is") is the whole story
// for them. `status` is PROVIDER-OWNED: the bank is the authority on whether its
// own charge has cleared. The refusal below is therefore TOTAL on a bank row, in
// both directions — the reader may only write what he owns — and that is not a
// weakening of the slice-2 rule but a different question: not "may he undo?" but
// "is this his to say?".
//
// The refusal rests on AUTHORITY, not on a re-assertion loop. An earlier draft of
// the sentence said the feed "says so again on every sync — a change here would be
// overwritten", and a critic falsified it: Plaid's `/transactions/sync` is a cursor
// DELTA that never re-sends an unmodified settled row, and SimpleFIN refetches only
// a ~5-day window, so for the commonest bank row nothing would overwrite a local
// edit. The policy survived; its stated reason did not, and the wrong reason is the
// dangerous half — it is what the next editor would rely on.
//
// A SPLIT PIECE's status belongs to the CHARGE it came from, not to the piece —
// which is why the asymmetry that governs reader-owned flags does not reach it,
// and why pieces are refused in BOTH directions (critic B, P1-3, executed):
// `splitTransaction` gives children no `providerRef` (server/triage-actions.ts),
// so a piece of a BANK charge reads as 'entered' and would have been offered a
// write — while both providers push the parent's status onto its children
// (`updateMany({ where: { splitParentId }, data: { status } })`,
// simplefin.ts:624-631, plaid.ts:1219-1226 and the id-churn path :1318-1321).
// The reader's answer would have been silently reverted on the next sync: exactly
// the "looks obeyed and is not" failure the bank refusal above exists to prevent.
// Resolving a piece's true owner means loading its parent at three call sites; the
// wave's governing failure direction (refuse rather than act too widely) makes the
// honest refusal the right trade, and the remedy is named in the sentence.
//
// The one cost is recorded rather than hidden: a piece of a row the READER marked
// pending before splitting it stays pending until he undoes the split. For a piece
// of a BANK charge there is no cost at all — the feed sets it when the charge
// posts.
export const STATUS_BLOCKED_BANK_OWNED =
  'Your bank reported this transaction, so whether it has cleared is the bank’s to say. Only a transaction you entered yourself can be marked by hand.';
export const STATUS_BLOCKED_SPLIT_PARENT =
  'A split container is left out of every total either way, so marking it would change no figure — mark its pieces instead.';
export const STATUS_BLOCKED_SPLIT_CHILD =
  'This is one piece of a split, and a charge clears as a whole — undo the split first if you need to change it.';

/**
 * MONEY IN is refused, and this is the sharpest rule here (critic A, P1, executed
 * against the real cash-needed engine).
 *
 * `assembleCashNeededInput` sums the SIGNED amounts of pending rows on the payment
 * account (cash-needed/assemble.ts:107) and the engine adds that total to today's
 * balance. So "pending" on an outflow means *money still to leave* — the
 * conservative reading the disclosure describes — while on an INFLOW it means
 * *money already arrived*, the exact opposite, and there is no date gate: a row
 * dated six weeks out counts today.
 *
 * Before this slice that state was only reachable from a provider, i.e. only for
 * money a BANK had observed in flight. Letting the reader type "+$2,000 EXPECTED
 * PAYCHECK" and mark it pending would let a HOPE cancel the dashboard's transfer
 * instruction: measured $500 shortfall → $0, recommendation gone. That is L.14's
 * figure-vs-instruction axis — a stale figure can be weighed, a missing
 * instruction bounces an autopay — so the capability is refused rather than
 * disclosed. Expected income has its own machinery (a recurring series /
 * ScheduledTransaction), which projects on a DATE instead of landing in today's
 * cash.
 */
export const STATUS_BLOCKED_INFLOW =
  'This is money in, and Aimplifi only tracks a cleared-or-not state for money going out — a deposit you are still expecting belongs in your recurring income instead.';

/**
 * What marking a row pending actually does — L.29: a surface that starts hiding
 * money says so. Every clause was verified against the gate that makes it true,
 * because the obvious sentence ("it stops counting as spending") is FALSE here:
 *
 *   COUNTS IT EITHER WAY — `isSpendRow` (reports.ts:43-48) does not read `status`
 *     at all, so /reports, /budgets, /trends pace+movers and the register's own
 *     summary are unchanged by this action.
 *   LEAVES IT OUT — bill/recurring detection (server/recurring.ts:61,
 *     coach.ts:215+258), savings rate (fi/insights.ts:36), Merchant Lens
 *     (merchant/profile.ts:89), the tax export (tax/export.ts:142+233), the
 *     household digest (household/digest.ts:76), anomaly detection
 *     (anomaly/detect.ts:80), radar's discretionary burn (radar/burn.ts:67), the
 *     row-NAMING insights on /trends and in Ask (trends.ts:483, answer.ts:621),
 *     and auto-filing (categorize/transfers.ts:106).
 *   ADDS IT — cash-needed's "still to leave" sum, which is scoped to the payment
 *     account and non-containers (cash-needed/assemble.ts:107). The clause names
 *     that condition rather than asserting it applies to every row.
 *
 * SCOPE: this sentence describes an OUTFLOW. The pending sum is SIGNED, so on an
 * inflow "pending" means money already arrived — the opposite of the last clause.
 * The reader can no longer create that state (`STATUS_BLOCKED_INFLOW`), but a
 * PROVIDER still can, so the caller renders this only for outflows. Both halves
 * are needed: the refusal stops the reader manufacturing cash, and the render
 * gate stops us describing a bank's pending deposit with an outflow's sentence.
 */
export const STATUS_PENDING_EFFECT =
  'Pending means the money has not settled yet. Your category totals and budgets still count it, but bill detection, your savings rate, merchant totals and the tax export leave it out — and on your payment account it counts as cash still to leave.';

/**
 * The slice-6 "two orders" class, one column over: a tax tag is an explicit
 * instruction about a figure bound for a preparer, and the tax export drops
 * pending rows outright (export.ts:142). Marking a TAGGED row pending therefore
 * silently removes a deduction the reader asked for, so it is disclosed at the
 * moment of the action rather than discovered at the export.
 */
export const STATUS_PENDING_TAX_CAUTION =
  'This transaction carries a tax tag, and the tax export leaves pending rows out — it will not appear in your tax-year totals until you mark it cleared.';

export const CATEGORY_BLOCKED_SPLIT_PARENT =
  'The pieces of this split carry the categories — file those instead.';
// Existing copy, reused verbatim (source: transaction-detail-view.tsx tax-on-parent).
export const TAX_BLOCKED_SPLIT_PARENT =
  'A tax tag belongs on the pieces, not on this container — the tax report leaves a split container out entirely, so a tag here would never reach it.';

/**
 * All ten actions, always, in menu order. The caller renders exactly this
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

  // O.13f: "this repeats" / "this does not" — the lever for the two cases the
  // three-sighting detection bar cannot serve. Refused on the two row shapes the
  // detector never reads (a split container, a transfer), because an instruction
  // that matches nothing is worse than a refusal: it looks obeyed.
  const markRecurring: TxnActionAvailability = t.isSplitParent
    ? { kind: 'markRecurring', label: 'Recurring…', enabled: false, reason: RECURRING_BLOCKED_SPLIT_PARENT }
    : t.isTransfer
      ? { kind: 'markRecurring', label: 'Recurring…', enabled: false, reason: RECURRING_BLOCKED_TRANSFER }
      : { kind: 'markRecurring', label: 'Recurring…', enabled: true, reason: null };

  // O.13g. Every branch is a refusal of something the reader may not answer for,
  // in the order the questions have to be asked:
  //   1. a FED row — not the reader's column to write (see the block above);
  //   2. a SPLIT PIECE — the charge's status, not the piece's, and the feed
  //      rewrites pieces from their parent (critic P1, found independently by two
  //      critics). Refused in BOTH directions, which is why it precedes the
  //      clearing branch: this is not the reader-owned state the never-lock-the-
  //      undo rule protects, and the remedy (undo the split) is in the sentence;
  //   3. a CONTAINER — inert in every sum, so marking it looks obeyed and is not;
  //   4. an INFLOW — see below;
  //   5. otherwise the reader owns the answer, and only then does direction matter.
  // A transfer is deliberately NOT refused: an 'entered' transfer that has not
  // landed is exactly the row this action exists for, and it is an OUTFLOW from
  // the account it leaves, so it carries none of the inflow hazard below.
  const isPending = t.status === 'PENDING';
  const bothWays = isPending ? 'Mark as cleared' : 'Mark as pending';
  const statusAction: TxnActionAvailability =
    t.descriptorOrigin === 'bank'
      ? { kind: 'status', label: bothWays, enabled: false, reason: STATUS_BLOCKED_BANK_OWNED }
      : t.splitParentId !== null
        ? { kind: 'status', label: bothWays, enabled: false, reason: STATUS_BLOCKED_SPLIT_CHILD }
        : t.isSplitParent
          ? { kind: 'status', label: bothWays, enabled: false, reason: STATUS_BLOCKED_SPLIT_PARENT }
          : t.amountCents >= 0
            ? { kind: 'status', label: bothWays, enabled: false, reason: STATUS_BLOCKED_INFLOW }
            : isPending
              ? { kind: 'status', label: 'Mark as cleared', enabled: true, reason: null, nextStatus: 'POSTED' }
              : { kind: 'status', label: 'Mark as pending', enabled: true, reason: null, nextStatus: 'PENDING' };

  return [
    category,
    rule,
    renamePayee,
    note,
    taxTag,
    split,
    markRecurring,
    reimbursement,
    exclude,
    statusAction,
  ];
}
