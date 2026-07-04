/**
 * Learn-from-corrections engine (DECISIONS #161) — known-answer acceptance tests.
 *
 * The owner re-files "credit card paid" / "check paid" → transfer every sync and
 * the system never learns. These tests pin the passive-learning contract: a key
 * corrected to the SAME category >= N times (with zero conflicts) becomes a rule
 * `categorize()` applies to the next transaction — while one "Zelle → rent"
 * never files every Zelle as rent (the headline over-generalization guard).
 *
 * Every expected signature value below was locked against the real
 * computeDescriptorSignature via a tsx trace before being written here.
 */
import { describe, expect, it } from 'vitest';
import {
  categorize,
  ruleMatches,
  type RuleLike,
  type TxnInput,
} from '@/lib/engine/categorize/pipeline';
import {
  deriveLearnedRules,
  LEARN_THRESHOLD,
  LEARNED_PRIORITY,
  type LearnedCorrectionInput,
} from '@/lib/engine/categorize/learn';
import {
  computeDescriptorSignature,
  hasDistinguishingToken,
} from '@/lib/engine/categorize/signature';

let seq = 0;
function corr(
  transactionId: string,
  toCategoryId: string,
  rawDescriptor: string,
  amountCents: number,
  opts: { isUndo?: boolean } = {},
): LearnedCorrectionInput {
  return { transactionId, toCategoryId, rawDescriptor, amountCents, isUndo: opts.isUndo ?? false, seq: seq++ };
}

function txn(over: Partial<TxnInput> & { rawDescriptor: string }): TxnInput {
  return { amountCents: -50000, date: '2026-09-01', accountId: 'acct-x', ...over };
}

describe('computeDescriptorSignature — noise stripped, identity kept', () => {
  it('collapses a date-fragmented descriptor to one key', () => {
    expect(computeDescriptorSignature('CREDIT CARD PAID 07/01')).toBe('CREDIT CARD PAID');
    expect(computeDescriptorSignature('CREDIT CARD PAID 08/01')).toBe('CREDIT CARD PAID');
    expect(computeDescriptorSignature('CREDIT CARD PAID')).toBe('CREDIT CARD PAID');
    expect(computeDescriptorSignature('2026-07-01 XFER')).toBe('XFER');
  });

  it('strips money amounts but KEEPS identity numbers (check / account / phone)', () => {
    // amounts (…\.dd) go; a bare check number stays, so two checks differ
    expect(computeDescriptorSignature('CHECK PAID 1234')).toBe('CHECK PAID 1234');
    expect(computeDescriptorSignature('CHECK PAID 5678')).toBe('CHECK PAID 5678');
    expect(computeDescriptorSignature('CHECK #1234')).toBe('CHECK 1234');
    expect(computeDescriptorSignature('AMZN 12.34')).toBe('AMZN');
  });

  it('KEEPS the payee token AND number so distinct payees stay distinct', () => {
    expect(computeDescriptorSignature('ZELLE PAYMENT TO LANDLORD')).toBe('ZELLE PAYMENT TO LANDLORD');
    expect(computeDescriptorSignature('ZELLE PAYMENT TO JOHN 07/01')).toBe('ZELLE PAYMENT TO JOHN');
    // a numeric (phone) payee is retained → two phone payees never collapse
    expect(computeDescriptorSignature('ZELLE PAYMENT TO 5551234567')).not.toBe(
      computeDescriptorSignature('ZELLE PAYMENT TO 5559998888'),
    );
  });

  it('recognizes payee-less signatures structurally (never learnable)', () => {
    // channel roots + glue, generic transaction-type / mechanism labels, and the
    // bare payment-frequency / card-entry labels US banks emit with no payee
    // (cycle 4 — these have no number to keep distinct billers apart, so the bare
    // residue must not be learnable)
    for (const s of [
      'CHECK', 'CHECK PAID', 'ZELLE PAYMENT', 'ZELLE PAYMENT TO', 'CARD PAYMENT',
      'STORE CARD PURCHASE', 'DIRECT DEBIT', 'PREAUTHORIZED DEBIT', 'POINT OF SALE PURCHASE',
      'SERVICE CHARGE', 'MONTHLY FEE', 'INTEREST CHARGE', 'LOAN PAYMENT', 'PENDING TRANSACTION',
      'AUTOMATIC PAYMENT', 'AUTOMATED PAYMENT', 'AUTO PAY', 'SCHEDULED PAYMENT',
      'REGULAR PAYMENT', 'PERIODIC PAYMENT', 'PREARRANGED PAYMENT', 'GENERAL PAYMENT',
      'STANDARD PAYMENT', 'PIN PURCHASE', 'SIGNATURE DEBIT',
    ]) {
      expect(hasDistinguishingToken(s), s).toBe(false);
    }
    // the owner's specific phrases + real payees DO carry a distinguishing token —
    // incl. real brands whose NAME happens to contain a now-noise adjective
    expect(hasDistinguishingToken('CREDIT CARD PAID')).toBe(true); // "CREDIT"
    expect(hasDistinguishingToken('ZELLE PAYMENT TO LANDLORD')).toBe(true); // "LANDLORD"
    expect(hasDistinguishingToken('SOFI LOAN PAYMENT')).toBe(true); // "SOFI"
    expect(hasDistinguishingToken('GEORGIA POWER BILLPAY')).toBe(true); // "GEORGIA POWER"
    expect(hasDistinguishingToken('GENERAL MOTORS')).toBe(true); // "MOTORS"
    expect(hasDistinguishingToken('AUTOMATIC DATA PROCESSING')).toBe(true); // "DATA"
    expect(hasDistinguishingToken('SIGNATURE PROPERTIES LLC')).toBe(true); // "PROPERTIES"
  });
});

describe('deriveLearnedRules — the centerpiece', () => {
  it('demo / empty history learns nothing (goldens byte-identical)', () => {
    expect(deriveLearnedRules([])).toEqual([]);
  });

  it('CANARY: date-fragmented "credit card paid" ×2 → a signature rule applied to the 3rd', () => {
    const rules = deriveLearnedRules([
      corr('a', 'transfer', 'CREDIT CARD PAID 07/01', -80000),
      corr('b', 'transfer', 'CREDIT CARD PAID 08/01', -75000),
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      merchantCanonical: null,
      descriptorSignature: 'CREDIT CARD PAID',
      categoryId: 'transfer',
      priority: LEARNED_PRIORITY,
    });
    // applied to next month's brand-new row (a different canonical) by categorize
    const out = categorize(txn({ rawDescriptor: 'CREDIT CARD PAID 09/01', amountCents: -70000 }), rules);
    expect(out.categoryId).toBe('transfer');
    expect(out.source).toBe('user-rule');
    expect(out.needsReview).toBe(false);
  });

  it('learns a recurring unknown descriptor, scoped to its exact signature', () => {
    // A repeating same-descriptor charge (no varying number) learns…
    const rules = deriveLearnedRules([
      corr('a', 'dining', 'JOES CORNER DELI', -1200),
      corr('b', 'dining', 'JOES CORNER DELI', -1500),
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ merchantCanonical: null, descriptorSignature: 'JOES CORNER DELI', categoryId: 'dining' });
    expect(categorize(txn({ rawDescriptor: 'JOES CORNER DELI', amountCents: -900 }), rules).categoryId).toBe('dining');
    // …but a DIFFERENT descriptor is never blanketed by it
    expect(categorize(txn({ rawDescriptor: 'JOES OTHER SHOP', amountCents: -900 }), rules).categoryId).not.toBe('dining');
  });

  it('does NOT merge two DIFFERENT-numbered occurrences (conservative)', () => {
    // distinct store/txn numbers → distinct signatures → neither reaches the
    // threshold → nothing learned (the safe direction; explicit "Always" is the
    // canonical-wide tool).
    expect(deriveLearnedRules([
      corr('a', 'shopping', 'SQ *POPUP MARKET 0042', -3000),
      corr('b', 'shopping', 'SQ *POPUP MARKET 0087', -3200),
    ])).toEqual([]);
  });

  it('CANARY: one "Zelle → rent" never files other Zelles as rent', () => {
    // single example — below threshold — learns nothing at all
    expect(deriveLearnedRules([corr('a', 'rent', 'ZELLE PAYMENT TO LANDLORD', -200000)])).toEqual([]);

    // two of the SAME payee — learns, but scoped to that payee only
    const rules = deriveLearnedRules([
      corr('a', 'rent', 'ZELLE PAYMENT TO LANDLORD', -200000),
      corr('b', 'rent', 'ZELLE PAYMENT TO LANDLORD', -200000),
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ descriptorSignature: 'ZELLE PAYMENT TO LANDLORD', categoryId: 'rent' });
    // the landlord Zelle is filed…
    expect(categorize(txn({ rawDescriptor: 'ZELLE PAYMENT TO LANDLORD', amountCents: -200000 }), rules).categoryId).toBe('rent');
    // …but a DIFFERENT payee's Zelle is untouched (stays in review)
    const other = categorize(txn({ rawDescriptor: 'ZELLE PAYMENT TO FRIEND', amountCents: -4000 }), rules);
    expect(other.categoryId).not.toBe('rent');
    expect(other.needsReview).toBe(true);
  });

  it('CANARY: distinct checks never blanket-learn (distinct numbers → distinct signatures)', () => {
    expect(deriveLearnedRules([
      corr('a', 'transfer', 'CHECK #1234', -50000),
      corr('b', 'transfer', 'CHECK #5678', -60000),
    ])).toEqual([]);
    // even a payee-less check that DID recur verbatim (date-only) is refused by
    // the distinguishing-token guard — a bare check is inherently ambiguous
    expect(deriveLearnedRules([
      corr('c', 'transfer', 'CHECK PAID 07/01', -50000),
      corr('d', 'transfer', 'CHECK PAID 08/01', -60000),
    ])).toEqual([]);
  });

  it('a conflicting correction blocks learning', () => {
    // same signature, two different categories → refused
    const rules = deriveLearnedRules([
      corr('a', 'utilities', 'METRO WATER DISTRICT', -5000),
      corr('b', 'rent', 'METRO WATER DISTRICT', -6000),
    ]);
    expect(rules).toEqual([]);
  });

  it('sign guard (#44): never learns an inflow into a spend category', () => {
    const rules = deriveLearnedRules([
      corr('a', 'dining', 'SOME REFUNDY THING', +5000),
      corr('b', 'dining', 'SOME REFUNDY THING', +6000),
    ]);
    expect(rules).toEqual([]);
  });

  it('an undone correction is not demonstrated intent', () => {
    seq = 0; // deterministic ordering for this case
    const rules = deriveLearnedRules([
      corr('a', 'rent', 'ZELLE PAYMENT TO LANDLORD', -200000), // seq 0
      corr('a', 'uncategorized', 'ZELLE PAYMENT TO LANDLORD', -200000, { isUndo: true }), // seq 1 — reverts txn a
      corr('b', 'rent', 'ZELLE PAYMENT TO LANDLORD', -200000), // seq 2 — only ONE live intent remains
    ]);
    expect(rules).toEqual([]); // a is reverted, b alone is below threshold
  });

  it('latest correction wins when the user changes their mind', () => {
    seq = 0;
    const rules = deriveLearnedRules([
      corr('a', 'dining', 'FOODPLACE LOCAL', -3000), // seq 0
      corr('a', 'groceries', 'FOODPLACE LOCAL', -3000), // seq 1 — a's net intent is groceries
      corr('b', 'groceries', 'FOODPLACE LOCAL', -3200), // seq 2
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0].categoryId).toBe('groceries');
  });

  it('exactly LEARN_THRESHOLD is the boundary', () => {
    expect(LEARN_THRESHOLD).toBe(2);
    const one = deriveLearnedRules([corr('a', 'transfer', 'CREDIT CARD PAID 01/01', -1000)]);
    expect(one).toEqual([]);
    const two = deriveLearnedRules([
      corr('a', 'transfer', 'CREDIT CARD PAID 01/01', -1000),
      corr('b', 'transfer', 'CREDIT CARD PAID 02/01', -1000),
    ]);
    expect(two).toHaveLength(1);
  });
});

describe('hostile-critic regressions (#161 cycles 1–2 — all CONFIRMED then FIXED)', () => {
  it('P0 (c1/c2): a numeric-payee transfer never blanket-files unrelated payees', () => {
    // Different phone/account payees keep their number → different signatures →
    // never group. Holds regardless of channel wording (ZELLE / ONLINE BANKING /
    // WEB PAY / ACH PPD) because it does NOT depend on a noise-word list.
    for (const [x, y] of [
      ['ZELLE PAYMENT TO 5551234567', 'ZELLE PAYMENT TO 5559998888'],
      ['ZELLE SEND MONEY TO 5551112222', 'ZELLE SEND MONEY TO 5553334444'],
      ['ONLINE BANKING TRANSFER TO 000999888', 'ONLINE BANKING TRANSFER TO 111222333'],
      ['WEB PAY 12345', 'WEB PAY 67890'],
      ['ACH DEBIT PPD 1112223', 'ACH DEBIT PPD 4445556'],
    ]) {
      expect(deriveLearnedRules([corr('a', 'rent', x, -150000), corr('b', 'rent', y, -150000)])).toEqual([]);
    }
    // a NAMED payee still learns, scoped to that payee only
    const named = deriveLearnedRules([
      corr('c', 'rent', 'ZELLE PAYMENT TO ACME PROPERTY', -150000),
      corr('d', 'rent', 'ZELLE PAYMENT TO ACME PROPERTY', -150000),
    ]);
    expect(named).toHaveLength(1);
    expect(categorize(txn({ rawDescriptor: 'ZELLE PAYMENT TO 9998887777', amountCents: -4000 }), named).categoryId).not.toBe('rent');
  });

  it('P1 (c1): a payee-less descriptor that recurs verbatim is refused', () => {
    for (const raw of ['CHECK PAID', 'CARD PAYMENT', 'ONLINE BANKING TRANSFER']) {
      expect(deriveLearnedRules([
        corr('a', 'transfer', `${raw} 07/01`, -50000),
        corr('b', 'transfer', `${raw} 08/01`, -60000),
      ])).toEqual([]);
    }
  });

  it('P0 (c1): a many-payee collapse canonical (Store Card Purchase) never blanket-files', () => {
    // Distinct txn numbers → distinct signatures → never reaches threshold.
    expect(deriveLearnedRules([
      corr('a', 'electronics', 'STORE CARD PURCHASE 07/15 APPLE CARD 1234', -20000),
      corr('b', 'electronics', 'STORE CARD PURCHASE 08/15 APPLE CARD 5678', -30000),
    ])).toEqual([]);
  });

  it('P1 (c2): a bucket canonical (HMSHOST → "Airport Dining") never over-generalizes across outlets', () => {
    // No canonical mode: two different airport outlets have different signatures,
    // so correcting them can never file a THIRD unrelated outlet.
    const rules = deriveLearnedRules([
      corr('a', 'coffee', 'HMSHOST-ATLANTA STARBUCKS', -600),
      corr('b', 'coffee', 'HMSHOST-DENVER PEETS', -650),
    ]);
    expect(categorize(txn({ rawDescriptor: 'HMSHOST-LAX STEAKHOUSE', amountCents: -6000 }), rules).categoryId).not.toBe('coffee');
  });

  it('P1 (c3): payee-less GENERIC bank labels never learn, but a named biller does', () => {
    // generic mechanism labels shared by many billers → refused even if they
    // recur verbatim (a 3rd unrelated biller of a different category must not
    // be auto-filed)
    for (const raw of ['DIRECT DEBIT', 'POINT OF SALE PURCHASE', 'SERVICE CHARGE', 'LOAN PAYMENT']) {
      expect(deriveLearnedRules([
        corr('a', 'utilities', `${raw} 07/01`, -5000),
        corr('b', 'utilities', `${raw} 08/01`, -5000),
      ]), raw).toEqual([]);
    }
    // …while a NAMED biller carrying a generic co-token still learns
    const named = deriveLearnedRules([
      corr('c', 'utilities', 'GEORGIA POWER BILLPAY 07/01', -9000),
      corr('d', 'utilities', 'GEORGIA POWER BILLPAY 08/01', -9500),
    ]);
    expect(named).toHaveLength(1);
    expect(named[0].descriptorSignature).toBe('GEORGIA POWER BILLPAY');
  });

  it('P1 (c4): a bare "AUTOMATIC PAYMENT" learned on biller A never blankets unrelated biller B', () => {
    // The exact cycle-4 repro: a bank labels every autopay a bare
    // "AUTOMATIC PAYMENT <date>" (no payee, no number). Correcting the MORTGAGE
    // twice must NOT then auto-file an unrelated CAR-LOAN outflow sharing the same
    // bare label as rent — there is no number to distinguish them, so the bare
    // residue must refuse to learn at all.
    const rules = deriveLearnedRules([
      corr('a', 'rent', 'AUTOMATIC PAYMENT 07/01', -180000),
      corr('b', 'rent', 'AUTOMATIC PAYMENT 08/01', -180000),
    ]);
    expect(rules).toEqual([]); // nothing learned from the bare label
    // and the categorizer leaves the unrelated car loan in review, not filed rent
    const carLoan = categorize(
      txn({ rawDescriptor: 'AUTOMATIC PAYMENT 09/15', amountCents: -42000, accountId: 'acct-loan' }),
      rules,
    );
    expect(carLoan.categoryId).not.toBe('rent');
    expect(carLoan.needsReview).toBe(true);

    // every sibling bare-label form the class covers refuses identically
    for (const raw of [
      'SCHEDULED PAYMENT', 'REGULAR PAYMENT', 'PERIODIC PAYMENT', 'GENERAL PAYMENT',
      'STANDARD PAYMENT', 'AUTO PAY', 'PIN PURCHASE', 'SIGNATURE DEBIT',
    ]) {
      expect(deriveLearnedRules([
        corr('a', 'rent', `${raw} 07/01`, -180000),
        corr('b', 'rent', `${raw} 08/01`, -180000),
      ]), raw).toEqual([]);
    }

    // …but a NAMED biller whose descriptor merely CONTAINS such an adjective still
    // learns (the brand token survives) — the fix refuses only the payee-less residue
    const branded = deriveLearnedRules([
      corr('c', 'transfer', 'AUTOMATIC PAYMENT ALLY AUTO 07/01', -42000),
      corr('d', 'transfer', 'AUTOMATIC PAYMENT ALLY AUTO 08/01', -42000),
    ]);
    expect(branded).toHaveLength(1);
    // the rule keys on the FULL identity-preserving signature; ALLY is merely the
    // token that lets it pass hasDistinguishingToken (so it is NOT payee-less)
    expect(branded[0].descriptorSignature).toBe('AUTOMATIC PAYMENT ALLY AUTO');
    expect(
      categorize(txn({ rawDescriptor: 'AUTOMATIC PAYMENT ALLY AUTO 09/01', amountCents: -42000 }), branded).categoryId,
    ).toBe('transfer');
  });

  it('a learned rule auto-files as a VISIBLE, correctable guess (AI badge), not silently', () => {
    const rules = deriveLearnedRules([
      corr('a', 'transfer', 'CREDIT CARD PAID 07/01', -80000),
      corr('b', 'transfer', 'CREDIT CARD PAID 08/01', -75000),
    ]);
    const out = categorize(txn({ rawDescriptor: 'CREDIT CARD PAID 09/01', amountCents: -70000 }), rules);
    expect(out.needsReview).toBe(false); // drains the review pile
    expect(out.aiBadge).toBe(true); // but visibly a learned guess
    expect(out.confidenceBps).toBeLessThan(9000); // below the silent band
  });

  it('P1 (c1): match-time sign guard — an income-learned rule never books a later outflow as income', () => {
    const rules = deriveLearnedRules([
      corr('a', 'income', 'PAYPAL *UPWORK 07/01', +200000),
      corr('b', 'income', 'PAYPAL *UPWORK 08/01', +200000),
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0].categoryId).toBe('income');
    // a future POSITIVE deposit is filed as income…
    const deposit = categorize(txn({ rawDescriptor: 'PAYPAL *UPWORK 09/01', amountCents: +200000 }), rules);
    expect(deposit.categoryId).toBe('income');
    // …but a NEGATIVE same-signature fee/refund is NOT — it routes to review
    const fee = categorize(txn({ rawDescriptor: 'PAYPAL *UPWORK 09/15', amountCents: -2000 }), rules);
    expect(fee.categoryId).not.toBe('income');
    expect(fee.needsReview).toBe(true);
  });
});

describe('ruleMatches — signature-mode rule', () => {
  const sigRule: RuleLike = {
    id: 'learned:sig:CREDIT CARD PAID:transfer',
    merchantCanonical: null,
    descriptorSignature: 'CREDIT CARD PAID',
    minAmountCents: null,
    maxAmountCents: null,
    weekendOnly: null,
    weekdayOnly: null,
    accountId: null,
    categoryId: 'transfer',
    priority: LEARNED_PRIORITY,
  };

  it('matches any descriptor reducing to its signature, and nothing else', () => {
    const yes = txn({ rawDescriptor: 'CREDIT CARD PAID 12/25' });
    const no = txn({ rawDescriptor: 'CREDIT CARD REWARDS 12/25' });
    expect(ruleMatches(sigRule, yes, computeDescriptorSignature('CREDIT CARD PAID 12/25'))).toBe(true);
    expect(ruleMatches(sigRule, no, computeDescriptorSignature('CREDIT CARD REWARDS 12/25'))).toBe(false);
  });

  it('an explicit rule with no signature is unaffected (backward compatible)', () => {
    const plain: RuleLike = { ...sigRule, descriptorSignature: null, merchantCanonical: 'Amazon' };
    expect(ruleMatches(plain, txn({ rawDescriptor: 'AMAZON' }), 'Amazon')).toBe(true);
    expect(ruleMatches(plain, txn({ rawDescriptor: 'TARGET' }), 'Target')).toBe(false);
  });
});
