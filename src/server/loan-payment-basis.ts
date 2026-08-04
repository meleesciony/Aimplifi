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
