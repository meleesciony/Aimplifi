/**
 * Category PROPOSAL engine (DECISIONS #331) — known-answer acceptance tests.
 *
 * The owner, live: "for venmo and other checks that are repetitive in value,
 * there should be a guess at category and ask for confirmation … any time you
 * can help categorize, propose it and ask for confirmation."
 *
 * These are the rows a RULE may never be built on — aggregate channels where
 * one canonical hides many unrelated payees — so the tests come in pairs: what
 * the engine proposes, and what it refuses to propose. The refusals are the
 * majority on purpose. A proposal that fires on a coincidence trains the reader
 * to tap "confirm" without reading, which is worse than proposing nothing.
 */
import { describe, expect, it } from 'vitest';
import {
  proposalReason,
  proposeCategory,
  PROPOSE_AMOUNT_THRESHOLD,
  type CategoryProposal,
} from '@/lib/engine/categorize/propose';
import type { LearnedCorrectionInput } from '@/lib/engine/categorize/learn';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';

let seq = 0;
function corr(
  transactionId: string,
  toCategoryId: string,
  rawDescriptor: string,
  amountCents: number,
  opts: { isUndo?: boolean } = {},
): LearnedCorrectionInput {
  return {
    transactionId,
    toCategoryId,
    rawDescriptor,
    amountCents,
    isUndo: opts.isUndo ?? false,
    seq: seq++,
  };
}

describe('premise: these rows can never carry a rule', () => {
  it('Venmo and Check are aggregates — one canonical, many payees', () => {
    expect(normalizeMerchant('VENMO PAYMENT 1029384756 JOHN SMITH').aggregate).toBe(true);
    expect(normalizeMerchant('CHECK PAID 1841').aggregate).toBe(true);
  });
});

describe('basis: same payee — rescues an aggregate whose txn id moves', () => {
  it('proposes from ONE prior correction to the same payee', () => {
    const p = proposeCategory(
      { rawDescriptor: 'VENMO PAYMENT 1938475620 JOHN SMITH', amountCents: -45000 },
      [corr('t1', 'childcare', 'VENMO PAYMENT 1029384756 JOHN SMITH', -45000)],
    );
    expect(p).not.toBeNull();
    expect(p!.categoryId).toBe('childcare');
    expect(p!.basis).toBe('payee');
    expect(p!.subject).toBe('JOHN SMITH');
  });

  it('a DIFFERENT payee on the same channel is never proposed', () => {
    const p = proposeCategory(
      { rawDescriptor: 'VENMO PAYMENT 5566778899 ACME LANDSCAPING', amountCents: -8000 },
      [corr('t1', 'childcare', 'VENMO PAYMENT 1029384756 JOHN SMITH', -45000)],
    );
    expect(p).toBeNull();
  });

  it('matches a payee whose name parts are reordered by the bank', () => {
    const p = proposeCategory(
      { rawDescriptor: 'VENMO *SMITH JOHN', amountCents: -45000 },
      [corr('t1', 'childcare', 'VENMO PAYMENT 1029384756 JOHN SMITH', -45000)],
    );
    expect(p?.categoryId).toBe('childcare');
    expect(p?.basis).toBe('payee');
  });

  it('a contradicting correction on the same payee withholds the proposal', () => {
    const p = proposeCategory(
      { rawDescriptor: 'VENMO PAYMENT 999 JOHN SMITH', amountCents: -45000 },
      [
        corr('t1', 'childcare', 'VENMO PAYMENT 111 JOHN SMITH', -45000),
        corr('t2', 'dining', 'VENMO PAYMENT 222 JOHN SMITH', -3000),
      ],
    );
    expect(p).toBeNull();
  });
});

describe("basis: repetitive value — the owner's literal case", () => {
  const CHECKS = [
    corr('c1', 'rent', 'CHECK PAID 1841', -145000),
    corr('c2', 'rent', 'CHECK PAID 1856', -145000),
  ];

  it('two prior checks for the SAME amount propose that category for the next', () => {
    const p = proposeCategory({ rawDescriptor: 'CHECK PAID 1874', amountCents: -145000 }, CHECKS);
    expect(p).not.toBeNull();
    expect(p!.categoryId).toBe('rent');
    expect(p!.basis).toBe('amount');
    expect(p!.matchedAmountCents).toBe(-145000);
    expect(p!.supportCount).toBe(2);
  });

  it('ONE prior check is not enough — the amount bar is two', () => {
    expect(PROPOSE_AMOUNT_THRESHOLD).toBe(2);
    const p = proposeCategory({ rawDescriptor: 'CHECK PAID 1874', amountCents: -145000 }, [CHECKS[0]!]);
    expect(p).toBeNull();
  });

  it('a DIFFERENT amount on the same channel is not proposed', () => {
    const p = proposeCategory({ rawDescriptor: 'CHECK PAID 1874', amountCents: -6000 }, CHECKS);
    expect(p).toBeNull();
  });

  it('a matching amount on a DIFFERENT channel is not proposed', () => {
    const p = proposeCategory(
      { rawDescriptor: 'ZELLE PAYMENT TO 5551234567', amountCents: -145000 },
      CHECKS,
    );
    expect(p).toBeNull();
  });

  it('an ordinary merchant purchase never proposes on amount alone', () => {
    // Two $45.00 restaurant charges must not make every $45.00 charge dining.
    const p = proposeCategory({ rawDescriptor: 'RANDOM NEW SHOP LLC', amountCents: -4500 }, [
      corr('a', 'dining', 'SOME BISTRO', -4500),
      corr('b', 'dining', 'ANOTHER BISTRO', -4500),
    ]);
    expect(p).toBeNull();
  });

  it('a CONTRADICTING payee kills the amount basis (the load-bearing guard)', () => {
    // Same channel, same $450.00 — but the history names a landlord and this row
    // names a contractor. The shared amount is a coincidence, not an identity.
    const p = proposeCategory(
      { rawDescriptor: 'VENMO PAYMENT 777 ACME CONTRACTING', amountCents: -45000 },
      [
        corr('t1', 'rent', 'VENMO PAYMENT 111 GREENTREE PROPERTIES', -45000),
        corr('t2', 'rent', 'VENMO PAYMENT 222 GREENTREE PROPERTIES', -45000),
      ],
    );
    expect(p).toBeNull();
  });

  it('an unnamed row (bare check number) contradicts nothing, so the amount stands', () => {
    const p = proposeCategory({ rawDescriptor: 'CHECK PAID 1874', amountCents: -145000 }, CHECKS);
    expect(p?.basis).toBe('amount');
  });

  it('payee evidence outranks amount evidence when both are available', () => {
    const p = proposeCategory({ rawDescriptor: 'VENMO PAYMENT 999 JOHN SMITH', amountCents: -45000 }, [
      corr('t1', 'childcare', 'VENMO PAYMENT 111 JOHN SMITH', -45000),
      corr('t2', 'childcare', 'VENMO PAYMENT 222 JOHN SMITH', -45000),
    ]);
    expect(p?.basis).toBe('payee');
  });
});

describe('basis: same merchant — the looser canonical key', () => {
  it('proposes when the canonical matches but the descriptor words do not', () => {
    // "#221 ATLANTA GA" and "#443" name the same store with different words, so
    // the payee basis misses and the canonical — which a RULE also earns here —
    // carries the proposal.
    const p = proposeCategory({ rawDescriptor: 'SQ *JOES PIZZA #443', amountCents: -2500 }, [
      corr('t1', 'groceries', 'SQ *JOES PIZZA #221 ATLANTA GA', -2500),
    ]);
    expect(p?.categoryId).toBe('groceries');
    expect(p?.basis).toBe('merchant');
    expect(p?.subject).toBe('Joes Pizza');
  });

  it('a bucket label a RULE may not use still earns a PROPOSAL', () => {
    // 'Electric Bill' fails canonicalIsLearnable (a table label broader than the
    // descriptor) but passes canonicalIsProposable. Here the payee basis wins
    // first — GEORGIA POWER survives both descriptors — which is the more
    // specific evidence and the better answer; the point is that the utility
    // whose REF number moves every month gets proposed at all.
    const p = proposeCategory(
      { rawDescriptor: 'GEORGIA POWER BILLPAY REF 90114', amountCents: -9500 },
      [corr('t1', 'utilities', 'GEORGIA POWER BILLPAY REF 88213', -9000)],
    );
    expect(p?.categoryId).toBe('utilities');
    expect(p?.basis).toBe('payee');
    expect(p?.subject).toBe('GEORGIA POWER');
  });

  it('an unrelated merchant is not proposed', () => {
    const p = proposeCategory({ rawDescriptor: 'SQ *MARIAS TACOS #900', amountCents: -2500 }, [
      corr('t1', 'groceries', 'SQ *JOES PIZZA #221 ATLANTA GA', -2500),
    ]);
    expect(p).toBeNull();
  });
});

describe('the universal refusals', () => {
  it('no history proposes nothing (demo goldens unaffected)', () => {
    expect(proposeCategory({ rawDescriptor: 'CHECK PAID 1874', amountCents: -145000 }, [])).toBeNull();
  });

  it('an undone correction is not evidence', () => {
    const p = proposeCategory({ rawDescriptor: 'VENMO PAYMENT 999 JOHN SMITH', amountCents: -45000 }, [
      corr('t1', 'childcare', 'VENMO PAYMENT 111 JOHN SMITH', -45000),
      corr('t1', 'childcare', 'VENMO PAYMENT 111 JOHN SMITH', -45000, { isUndo: true }),
    ]);
    expect(p).toBeNull();
  });

  it('an "un-file" to uncategorized is not a category choice', () => {
    const p = proposeCategory({ rawDescriptor: 'VENMO PAYMENT 999 JOHN SMITH', amountCents: -45000 }, [
      corr('t1', 'uncategorized', 'VENMO PAYMENT 111 JOHN SMITH', -45000),
    ]);
    expect(p).toBeNull();
  });

  it('the latest correction on one transaction wins, and counts once', () => {
    const p = proposeCategory({ rawDescriptor: 'VENMO PAYMENT 999 JOHN SMITH', amountCents: -45000 }, [
      corr('t1', 'dining', 'VENMO PAYMENT 111 JOHN SMITH', -45000),
      corr('t1', 'childcare', 'VENMO PAYMENT 111 JOHN SMITH', -45000),
    ]);
    expect(p?.categoryId).toBe('childcare');
    expect(p?.supportCount).toBe(1);
  });

  it('#44 sign guard: an inflow is never proposed into a spend category', () => {
    const p = proposeCategory({ rawDescriptor: 'VENMO PAYMENT 999 JOHN SMITH', amountCents: +45000 }, [
      corr('t1', 'childcare', 'VENMO PAYMENT 111 JOHN SMITH', -45000),
    ]);
    expect(p).toBeNull();
  });

  it('#44 sign guard: an outflow is never proposed into an Income category', () => {
    const p = proposeCategory({ rawDescriptor: 'VENMO PAYMENT 999 JOHN SMITH', amountCents: -45000 }, [
      corr('t1', 'income', 'VENMO PAYMENT 111 JOHN SMITH', +45000),
    ]);
    expect(p).toBeNull();
  });
});

describe('proposalReason — states the evidence, formats no money', () => {
  const base: CategoryProposal = {
    categoryId: 'rent',
    basis: 'amount',
    supportCount: 3,
    subject: 'Check',
    matchedAmountCents: -145000,
  };

  it('names the amount it matched on, as a FILING claim, never a register claim (O.9e P1-2)', () => {
    // "Your last 3 Check rows were Rent" would assert an ordering over the
    // REGISTER, which this engine never reads — a same-amount row the pipeline
    // auto-filed (no Correction) is invisible here, so "last" could be false
    // about rows the reader can see. "You filed 3 …" states what was measured.
    expect(proposalReason(base, { categoryLabel: 'Rent', amount: '$1,450.00' })).toBe(
      'You filed 3 Check rows for $1,450.00 as Rent.',
    );
    expect(proposalReason(base, { categoryLabel: 'Rent', amount: '$1,450.00' })).not.toContain('last');
  });

  it('names the payee and pluralizes honestly', () => {
    const one: CategoryProposal = { ...base, basis: 'payee', supportCount: 1, subject: 'JOHN SMITH' };
    expect(proposalReason(one, { categoryLabel: 'Childcare', amount: null })).toBe(
      'You filed an earlier payment to JOHN SMITH as Childcare.',
    );
    expect(
      proposalReason({ ...one, supportCount: 4 }, { categoryLabel: 'Childcare', amount: null }),
    ).toBe('You filed 4 earlier payments to JOHN SMITH as Childcare.');
  });

  it('names the merchant', () => {
    const m: CategoryProposal = { ...base, basis: 'merchant', supportCount: 2, subject: 'Electric Bill' };
    expect(proposalReason(m, { categoryLabel: 'Utilities', amount: null })).toBe(
      'You filed 2 earlier Electric Bill rows as Utilities.',
    );
  });

  it('every reason names both the evidence count and the category', () => {
    for (const basis of ['payee', 'amount', 'merchant'] as const) {
      const s = proposalReason(
        { ...base, basis, supportCount: 2 },
        { categoryLabel: 'Rent', amount: '$1,450.00' },
      );
      expect(s, basis).toContain('2');
      expect(s, basis).toContain('Rent');
      expect(s.endsWith('.'), basis).toBe(true);
    }
  });
});
