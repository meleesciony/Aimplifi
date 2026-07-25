/**
 * The /cards identity line (#298).
 *
 * Owner-reported 2026-07-24 from a live /cards screenshot: THREE cards named `CREDIT CARD` and TWO
 * named `Venture`, each with its own amount due, on the surface that tells him what to pay. The page
 * rendered `card.cardName` and nothing else, so there was no way to know which card a figure
 * belonged to. (The duplicate that prompted the screenshot was separate and he has since deleted it;
 * this is the residue that remains with zero duplicates.)
 *
 * Third surface of the #296/#297 disease, so it takes the same cure: compute EVERY card together and
 * make distinctness an invariant of construction rather than a property of the data.
 *
 * The identity is the account's last-4, which `getDashboardData` already carries
 * (`server/finance.ts:51`) — no new query, no engine change, and no name parsing. Deriving a last-4
 * from the NAME is deliberately NOT done here: #292 recorded that a parenthesized year
 * ("Roth IRA (2021)") and the x in "Amex" both mis-read as a last-4. That was tolerable for the
 * duplicate detector because it was positive-only and could merely surface a dismissable pair, but a
 * mis-read printed as THIS card's number would be a false claim about which card to pay.
 *
 * Pure and framework-free so the node suite can lock every rendered string.
 */
import { renderSafe } from './continued-accounts-view';

export const CARD_IDENTITY_TESTID = 'card-identity';

/**
 * No last-4 is stored for this account — say so plainly rather than print a guess or an empty
 * chip. Deliberately NOT "from your bank": a manually-added account always stores `mask: null`
 * (`server/networth-actions.ts:52`), and no bank was involved in it at all.
 */
export const NO_CARD_NUMBER = 'no card number on file';

/**
 * A last-4, or null. Nothing enforces the "last 4 only" comment on `Account.mask`
 * (`prisma/schema.prisma:155`) — Plaid's value is stored verbatim (`plaid-map.ts:121`) — so a feed
 * sending a full PAN would otherwise have printed it on screen behind four dots. Digits only, last
 * four kept; anything that yields no digits is treated as no number at all rather than rendered raw.
 *
 * Deliberately keeps a SHORT mask (Plaid returns 2- and 3-character masks for some institutions)
 * rather than discarding it — it still distinguishes cards — but see `identityFor`: the four dots
 * are only prefixed when there are actually four digits, so the glyphs never claim a length the
 * data does not have.
 */
export function lastFour(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = renderSafe(raw).replace(/\D/g, '');
  if (digits === '') return null;
  return digits.slice(-4);
}

export interface CardIdentityInput {
  cardId: string;
  cardName: string;
}

/**
 * `cardId -> identity line`, for every card that needs one.
 *
 * A card whose name already stands alone and has no last-4 gets NO entry: an identity line that
 * says nothing is noise on a dense money surface.
 *
 * Distinctness guarantee. If any two cards would render the same (name + identity) pair, EVERY card
 * is numbered by its position, as a PREFIX. That cannot be forged for any input: for i != j the
 * decimals differ at some digit, or one is a strict prefix of the other and the shorter is then
 * followed by '.' where the longer has a DIGIT — and a digit is never '.'. So the labels differ at a
 * fixed offset no matter what a bank calls an account. (#297's critic falsified the alternative:
 * appending a suffix writes into the same string space it compares, so a card literally named
 * "… (copy 1)" can tie with a rewritten one.)
 */
/**
 * ONE identity pass for a whole PAGE whose cards are painted by more than one component
 * (the dashboard: the cash-needed hero, then the payment-reminders list) — TASKS L.8.
 *
 * Two separate passes is the #299 residual, and a critic reproduced it here across components
 * rather than sections: each pass numbers from 1 over its own list, so with an Auto Loan reminder
 * above the duplicated pair, "1." meant the loan on one card and a credit card six inches below on
 * the other. The numbering is only ever a WITHIN-VIEW marker, and the view is the page.
 *
 * De-duplicated by `cardId`, first occurrence wins, order preserved — a card in both lists must be
 * numbered once, and passing it twice would make the ambiguity check see its own duplicate and
 * number every card on every dashboard.
 *
 * The caller passes CARD rows only. A loan reminder carries a real `Account.mask` too, but this
 * module's fallback string is "no card number on file", which on a mortgage row is the wrong noun
 * — and telling two loans apart is not what this exists for.
 */
export function dashboardCardIdentity(
  rows: readonly CardIdentityInput[],
  maskByCardId: Readonly<Record<string, string | null | undefined>>,
): Record<string, string> {
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    if (seen.has(r.cardId)) return false;
    seen.add(r.cardId);
    return true;
  });
  return cardIdentityLabels(unique, maskByCardId);
}

export function cardIdentityLabels(
  cards: readonly CardIdentityInput[],
  maskByCardId: Readonly<Record<string, string | null | undefined>>,
): Record<string, string> {
  const rows = cards.map((c) => {
    const mask = lastFour(maskByCardId[c.cardId]);
    return {
      cardId: c.cardId,
      name: renderSafe(c.cardName),
      mask,
      identity: mask ? (mask.length === 4 ? `····${mask}` : `ending ${mask}`) : null,
    };
  });

  // Compare what the reader SEES, not a private key. A card literally NAMED "Venture ····0977"
  // (those glyphs are copyable straight off /accounts) sitting beside a card named "Venture" whose
  // mask is 0977 paints two identical headings — while any separator-joined key calls them distinct
  // and skips the numbering. Same class as #297's "the rewrite writes into the string space it
  // compares": the only safe comparison is the rendered one.
  const painted = rows.map((r) => renderSafe(`${r.name} ${r.identity ?? ''}`));
  const ambiguous = new Set(painted).size !== painted.length;

  const out: Record<string, string> = {};
  rows.forEach((r, i) => {
    if (ambiguous) {
      // Every card is numbered, including the ones that were already unique — a number that
      // appeared on only some cards would read as a property of those cards rather than as a
      // position in this list.
      out[r.cardId] = `${i + 1}. ${r.identity ?? NO_CARD_NUMBER}`;
      return;
    }
    if (r.identity) out[r.cardId] = r.identity;
  });
  return out;
}
