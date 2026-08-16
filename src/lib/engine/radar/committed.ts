/**
 * C.22 — payment-account scope for radar committed-merchant detection and burn.
 *
 * The income fix remaps predecessor rows onto the live payment id and then
 * SUMS. Detection INFERS cadence from gaps, so the same remap concatenates
 * two feeds' rows for one merchant into one group — measured 9 series → 4
 * on the owner's re-link. The old feed's irregular dates or extra amounts
 * poison a clean series the new feed had alone. A 0-day handover gap is
 * the same class (U.13); monthly detection is median-only so one 0-gap
 * is not always enough, but three amounts always are.
 *
 * So the two questions stay uncoupled:
 *  - Detection: each payment-component account is its own series. Union the
 *    canonicals. Neither feed's descriptor "wins".
 *  - Burn sums / history days: remap onto the live id, then collapse the
 *    released handover day so that one charge is not counted twice.
 */
import { type ISODate } from '@/lib/dates';
import {
  collapseHandoverDuplicates,
  handoverDatesFromKeys,
} from '@/lib/engine/account/reconcile-boundary';
import { detectRecurring, type RecurringTxn } from '@/lib/engine/recurring/detect';
import type { RecurringOverrideInput } from '@/lib/engine/recurring/override';

export function paymentComponentId(
  accountId: string,
  terminalOf: ReadonlyMap<string, string>,
): string {
  return terminalOf.get(accountId) ?? accountId;
}

export function isPaymentComponent(
  accountId: string,
  paymentAccountId: string,
  terminalOf: ReadonlyMap<string, string>,
): boolean {
  return paymentComponentId(accountId, terminalOf) === paymentAccountId;
}

/**
 * Committed merchants on the payment account's real history — one
 * `detectRecurring` per account in the component, then the union.
 * Concatenating the rows first is the income remap and is the path that
 * destroys series.
 */
export function committedMerchantCanonicals(
  txns: readonly RecurringTxn[],
  paymentAccountId: string,
  today: ISODate,
  overrides: readonly RecurringOverrideInput[],
  terminalOf: ReadonlyMap<string, string>,
): Set<string> {
  const byAccount = new Map<string, RecurringTxn[]>();
  for (const t of txns) {
    if (!isPaymentComponent(t.accountId, paymentAccountId, terminalOf)) continue;
    const list = byAccount.get(t.accountId);
    if (list) list.push(t);
    else byAccount.set(t.accountId, [t]);
  }
  const out = new Set<string>();
  for (const group of byAccount.values()) {
    for (const series of detectRecurring(group, today, overrides)) {
      out.add(series.merchantCanonical);
    }
  }
  return out;
}

/**
 * Payment-component rows remapped onto the live payment id, with the
 * released handover day folded to one occurrence per component. Burn
 * sums and history days read this — they are totals, not gap inference.
 */
export function remappedPaymentRows<T extends { accountId: string; date: string; amountCents: number }>(
  rows: readonly T[],
  paymentAccountId: string,
  terminalOf: ReadonlyMap<string, string>,
  handoverKeys: ReadonlySet<string> = new Set<string>(),
): T[] {
  const scoped = rows.filter((r) => isPaymentComponent(r.accountId, paymentAccountId, terminalOf));
  const collapsed = collapseHandoverDuplicates(
    scoped,
    handoverDatesFromKeys(handoverKeys),
    terminalOf,
  );
  return collapsed.map((r) => (r.accountId === paymentAccountId ? r : { ...r, accountId: paymentAccountId }));
}
