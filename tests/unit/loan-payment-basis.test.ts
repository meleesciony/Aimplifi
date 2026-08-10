/**
 * O.18e-FU (TASKS, critic F3 of O.18e) — the C.25 basis sentence, locked.
 *
 * The sentence used to end in the universal "loan payments are not spending",
 * printed by five surfaces, and NO test anywhere asserted any of the five
 * strings. O.18e's F3 executed the defect: on /trends the pace card printed
 * the universal while the page's own "New this month" panel listed the same
 * payment as spending (register basis — the panel follows the activity list,
 * which shows the charge).
 *
 * The fix scopes the claim per surface ("not counted in THIS figure/list/…"),
 * composed in one pure module so the five surfaces cannot drift, and every
 * surface's sentence is now locked here VERBATIM — the C.26 lesson: a string
 * no test asserts may as well not exist.
 */
import { describe, expect, it } from 'vitest';
import {
  loanPaymentBasisSentence,
  type LoanPaymentBasisScope,
} from '@/server/loan-payment-basis';

const FACT = { payee: 'Mr Cooper', loanName: 'Mortgage', paymentCents: 621_707 };

const EXPECTED: Record<LoanPaymentBasisScope, string> = {
  'pace-figure':
    'Payments to Mr Cooper at $6,217.07/mo are counted on Mortgage, not in this pace figure. A payment at another amount counts normally.',
  figures:
    'Payments to Mr Cooper at $6,217.07/mo are counted on Mortgage, not in these figures. A payment at another amount counts normally.',
  cards:
    'Payments to Mr Cooper at $6,217.07/mo are counted on Mortgage, not in the figures on these cards. A payment at another amount counts normally.',
  'this-list':
    'Payments to Mr Cooper at $6,217.07/mo are counted on Mortgage, not in this list. A payment at another amount counts normally.',
  'page-figures':
    'Payments to Mr Cooper at $6,217.07/mo are counted on Mortgage, not in these figures. A payment at another amount (an escrow change, say) counts normally.',
};

const SCOPES = Object.keys(EXPECTED) as LoanPaymentBasisScope[];

describe('loanPaymentBasisSentence — the scoped C.25 disclosure (O.18e-FU)', () => {
  it('prints the exact sentence for every scope (verbatim contract)', () => {
    for (const scope of SCOPES) {
      expect(loanPaymentBasisSentence(FACT, scope)).toBe(EXPECTED[scope]);
    }
  });

  it('the F3 regression: NO scope claims "loan payments are not spending"', () => {
    for (const scope of SCOPES) {
      const s = loanPaymentBasisSentence(FACT, scope);
      expect(s).not.toContain('not spending');
      expect(s).not.toMatch(/loan payments are not/i);
    }
  });

  it('renders the amount once, through formatCents, in every scope', () => {
    for (const scope of SCOPES) {
      expect(loanPaymentBasisSentence(FACT, scope)).toContain('$6,217.07/mo');
    }
  });
});
