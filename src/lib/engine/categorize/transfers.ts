/**
 * Transfer detection (Phase 2 acceptance #7): credit-card payments and
 * own-account transfers must be excluded from spending/income.
 *
 * Detection = descriptor heuristics OR a matched opposite-amount pair across
 * two of the user's own accounts within ±3 days.
 */
import { daysBetween, isoDate } from '@/lib/dates';

export interface TransferTxn {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
}

const TRANSFER_DESCRIPTOR =
  /EPAY|PAYMENT THANK YOU|ONLINE TRANSFER|CARD PAYMENT|AUTOPAY|ACH WITHDRAWAL CARMAX/i;

export function detectTransfers(transactions: readonly TransferTxn[]): Set<string> {
  const transferIds = new Set<string>();

  for (const t of transactions) {
    if (TRANSFER_DESCRIPTOR.test(t.rawDescriptor)) transferIds.add(t.id);
  }

  // Pair matching: equal/opposite amounts, different accounts, within 3 days.
  const byAmount = new Map<number, TransferTxn[]>();
  for (const t of transactions) {
    const list = byAmount.get(Math.abs(t.amountCents)) ?? [];
    list.push(t);
    byAmount.set(Math.abs(t.amountCents), list);
  }
  for (const [, group] of byAmount) {
    for (const a of group) {
      if (a.amountCents >= 0) continue;
      for (const b of group) {
        if (b.amountCents <= 0 || b.accountId === a.accountId) continue;
        if (Math.abs(daysBetween(isoDate(a.date), isoDate(b.date))) <= 3) {
          transferIds.add(a.id);
          transferIds.add(b.id);
        }
      }
    }
  }

  return transferIds;
}

/** Sum spending (outflows) excluding transfers — the aggregation Phase 3 uses. */
export function spendingExcludingTransfers(
  transactions: readonly TransferTxn[],
  transferIds: Set<string>,
): number {
  let total = 0;
  for (const t of transactions) {
    if (t.amountCents < 0 && !transferIds.has(t.id)) total += -t.amountCents;
  }
  return total;
}

/** Sum income (inflows) excluding transfers. */
export function incomeExcludingTransfers(
  transactions: readonly TransferTxn[],
  transferIds: Set<string>,
): number {
  let total = 0;
  for (const t of transactions) {
    if (t.amountCents > 0 && !transferIds.has(t.id)) total += t.amountCents;
  }
  return total;
}
