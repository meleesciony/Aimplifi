/**
 * Joint cash-needed merge (HOUSEHOLD_ARCHITECTURE §4.4, TASKS 4.2 slice 4).
 * Pure, no I/O: combines the viewer's own cash-needed inputs with 0+ partners'
 * shared-account slices into one set the SAME assembly path
 * (`assembleCashNeededInput` / `cashNeededFromSnapshot`) already consumes —
 * the engine itself needs zero changes, since a card/loan/scheduled row's
 * owner is invisible to it (no user concept, recon-verified).
 */
import type { ISODate } from '@/lib/dates';
import type {
  AccountLike,
  AutopayLike,
  CardPaymentLike,
  ScheduledLike,
  StatementLike,
  TransactionLike,
} from '@/lib/engine/cash-needed/assemble';

/** The subset of a FinanceSnapshot that feeds cash-needed assembly — provider/DB agnostic. */
export interface CashNeededSnapshotSlice {
  accounts: AccountLike[];
  autopays: AutopayLike[];
  statements: StatementLike[];
  cardPayments: CardPaymentLike[];
  transactions: TransactionLike[];
  scheduled: ScheduledLike[];
}

/** A partner's shared slice, tagged with the business day it was read on. */
export interface PartnerSnapshotSlice extends CashNeededSnapshotSlice {
  today: ISODate;
}

/**
 * Merges the viewer's own slice with each live partner's shared-account slice.
 *
 * Disjoint-by-account-id union (T9): an account has exactly one owner, so
 * `mine` and every partner slice are guaranteed non-overlapping UNLESS
 * something upstream is broken (e.g. a viewer's own account leaking back as a
 * "partner" slice) — that would silently double-count a card's balance, so
 * this fails loudly rather than degrading to a wrong dollar figure.
 *
 * Drift guard: the viewer's own `today` is the reference — a partner slice
 * computed for a different business day is refused rather than silently
 * merged. Today this is nearly vacuous (one server clock drives every
 * partner's `businessToday`), but it stays honest if per-user timezones ever
 * land (HOUSEHOLD_ARCHITECTURE §4.4).
 */
export function mergeSnapshots(
  today: ISODate,
  mine: CashNeededSnapshotSlice,
  partners: PartnerSnapshotSlice[],
): CashNeededSnapshotSlice {
  const seen = new Set(mine.accounts.map((a) => a.id));
  for (const partner of partners) {
    if (partner.today !== today) {
      throw new Error(
        `mergeSnapshots: partner slice computed for ${partner.today}, viewer today is ${today}`,
      );
    }
    for (const a of partner.accounts) {
      if (seen.has(a.id)) {
        throw new Error(
          `mergeSnapshots: account ${a.id} appears in more than one household member's slice`,
        );
      }
      seen.add(a.id);
    }
  }

  return {
    accounts: mine.accounts.concat(...partners.map((p) => p.accounts)),
    autopays: mine.autopays.concat(...partners.map((p) => p.autopays)),
    statements: mine.statements.concat(...partners.map((p) => p.statements)),
    cardPayments: mine.cardPayments.concat(...partners.map((p) => p.cardPayments)),
    transactions: mine.transactions.concat(...partners.map((p) => p.transactions)),
    scheduled: mine.scheduled.concat(...partners.map((p) => p.scheduled)),
  };
}
