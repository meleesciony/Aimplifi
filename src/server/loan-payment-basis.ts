/**
 * C.25 (DECISIONS #403) — the disclosure facts for the read-side loan-payment
 * exclusion, named once for every surface that prints it. The assembler
 * computes the exclusion ONCE (same set everywhere); this module turns the
 * engine facts into the two NAMES a basis sentence needs — the payee that
 * left spending, and the loan the money is counted on instead. One
 * definition so /reports, /trends and /budgets cannot phrase the same fact
 * three different ways.
 *
 * Empty when no merchant qualifies (demo, SimpleFIN-only readers, undatable
 * loans) — silence is the correct sentence for "nothing moved".
 */
import { accountLabel } from '@/lib/engine/account/display-name';
import { cents, formatCents } from '@/lib/money';
import type { FinanceSnapshot } from '@/lib/providers/types';

export interface LoanPaymentBasisFact {
  /** The merchant canonical — the name the register itself prints (O.13a). */
  payee: string;
  loanName: string;
  paymentCents: number;
}

export function loanPaymentBasisFacts(snap: FinanceSnapshot): LoanPaymentBasisFact[] {
  const excluded = snap.loanPaymentFlowExclusions?.excluded;
  if (excluded === undefined || excluded.length === 0) return [];
  const accountById = new Map(snap.accounts.map((a) => [a.id, a]));
  return excluded.map((e) => {
    const loan = accountById.get(e.accountId);
    return {
      payee: e.canonical,
      loanName: loan ? accountLabel(loan) : 'your loan',
      paymentCents: e.paymentCents,
    };
  });
}

/**
 * The categories a register link must REFUSE after the exclusion (critic
 * P1-4): the stored categories of the excluded rows. A category figure that
 * dropped those rows cannot link to a register that still shows them — the
 * destination would not sum to the clicked number (the O.5/O.6 link
 * invariant). Empty when nothing was excluded.
 */
export function loanPaymentRefusedCategories(snap: FinanceSnapshot): string[] {
  const excludeIds = snap.loanPaymentFlowExclusions?.excludeIds;
  if (excludeIds === undefined || excludeIds.size === 0) return [];
  const out = new Set<string>();
  for (const t of snap.transactions) {
    if (t.id !== undefined && excludeIds.has(t.id)) out.add(t.categoryId ?? 'uncategorized');
  }
  return [...out];
}

/**
 * What a basis sentence may claim about the figure(s) it sits under.
 *
 * The C.25 sentence used to end in "loan payments are not spending" — a
 * universal, printed by five surfaces, and false wherever a surface lists the
 * rows the exclusion moved. O.18e's F3 executed exactly that: on /trends the
 * pace card printed it while the page's own "New this month" panel listed the
 * same payment as spending (the panel follows the register, which shows the
 * charge — the deliberate register basis of O.18e). Each scope names the
 * figures the claim actually covers, so a surface that counts the rows can
 * coexist with a sentence that never claimed they vanished.
 */
export type LoanPaymentBasisScope =
  /** /trends — the pace figure the sentence sits under. */
  | 'pace-figure'
  /** /coach — the savings-rate, creep-baseline and FI figures. */
  | 'figures'
  /** /dashboard — the cards on the page. */
  | 'cards'
  /** /budgets — the By-category list. */
  | 'this-list'
  /** /reports — the page figures, with the escrow-change boundary. */
  | 'page-figures';

/**
 * The basis sentence for one excluded loan payment, scoped to the figure(s)
 * the surface actually drops. One shape, five scopes — the surfaces cannot
 * phrase the same fact five different ways (this module's one-definition
 * promise, now including the sentence, not just the facts).
 *
 * The amount is rendered here, once, so every surface prints the same
 * string for the same payment.
 */
export function loanPaymentBasisSentence(
  fact: LoanPaymentBasisFact,
  scope: LoanPaymentBasisScope,
): string {
  const where = {
    'pace-figure': 'this pace figure',
    figures: 'these figures',
    // The O.18e-FU critic's P2-2: /dashboard also carries the recent-
    // transactions card, which lists the payment row itself — "not in these
    // cards" was the one scope a literal reading falsified. "The figures on
    // these cards" names the aggregates (savings rate, top spending, pace),
    // all of which drop the rows; the recent card shows raw amounts, not
    // figures, so the claim stays true beside it.
    cards: 'the figures on these cards',
    'this-list': 'this list',
    'page-figures': 'these figures',
  }[scope];
  const boundary =
    scope === 'page-figures'
      ? 'A payment at another amount (an escrow change, say) counts normally.'
      : 'A payment at another amount counts normally.';
  return (
    `Payments to ${fact.payee} at ${formatCents(cents(fact.paymentCents))}/mo are counted on ` +
    `${fact.loanName}, not in ${where}. ${boundary}`
  );
}
