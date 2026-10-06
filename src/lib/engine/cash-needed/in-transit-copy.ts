/**
 * The one sentence for card payments counted while in transit (#791). Every surface that
 * tells the reader a card is paid, or how much is left, on the strength of a payment the
 * card company has not shown yet says so in these words — what was counted, from which
 * account, on which day — and nothing about why the card company is slow, which the app
 * cannot see.
 *
 * `label` lets a surface name the card and the account the way it names them everywhere
 * else on the page — at household scope, with the partner who owns them (critic cycle 1, P3).
 */
import { formatISODate } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import type { InTransitPaymentNote } from './types';

export function inTransitPaymentsSentence(
  notes: readonly InTransitPaymentNote[],
  label: { card?: (n: InTransitPaymentNote) => string; account?: (n: InTransitPaymentNote) => string } = {},
): string | null {
  if (notes.length === 0) return null;
  const card = label.card ?? ((n: InTransitPaymentNote) => n.cardName);
  const account = label.account ?? ((n: InTransitPaymentNote) => n.fromAccountName);
  const items = notes.map((n) => `${formatCents(n.amountCents)} to ${card(n)} (left ${account(n)} ${formatISODate(n.date)})`);
  const list = items.length === 1 ? items[0] : `${items.slice(0, -1).join('; ')}; and ${items[items.length - 1]}`;
  return notes.length === 1
    ? `Counted as paid before the card company shows it: ${list}. It matches what was left to pay on that card’s statement, to the cent.`
    : `Counted as paid before the card companies show them: ${list}. Each matches what was left to pay on that card’s statement, to the cent.`;
}
