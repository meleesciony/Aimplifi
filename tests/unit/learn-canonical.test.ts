/**
 * Canonical-keyed learning (DECISIONS #331) — known-answer acceptance tests.
 *
 * The owner's report, verbatim: "when categorizing, i've already inputed many
 * and the system still doesn't recognize that the others are the same, perhaps
 * by small differences in how it's notated."
 *
 * Measured before the fix, via the real engines: three visits to one restaurant
 * ("SQ *JOES PIZZA #221 ATLANTA GA", "#443", no store number) produce THREE
 * distinct descriptor signatures and ONE merchant canonical — so three
 * corrections derived ZERO learned rules and the fourth visit still landed in
 * review. Same shape for a utility whose REF number moves and a gym whose auth
 * code moves.
 *
 * These tests pin the second learning key: the merchant canonical, which
 * already strips store numbers, long digit runs, processor prefixes and a
 * CITY ST suffix. They also pin the refusals that keep it safe — aggregates
 * (one canonical, many unrelated payees) and the unnameable residue.
 *
 * Every descriptor below was run through the real `normalizeMerchant` /
 * `computeDescriptorSignature` before the expectations were written.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalIsLearnable,
  canonicalIsProposable,
  deriveCorrectionHints,
  deriveLearnedRules,
  LEARNED_CANONICAL_PRIORITY,
  LEARNED_PRIORITY,
  type LearnedCorrectionInput,
} from '@/lib/engine/categorize/learn';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { computeDescriptorSignature } from '@/lib/engine/categorize/signature';
import { categorize, type TxnInput } from '@/lib/engine/categorize/pipeline';

let seq = 0;
function corr(
  transactionId: string,
  toCategoryId: string,
  rawDescriptor: string,
  amountCents = -2500,
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

function txn(over: Partial<TxnInput> & { rawDescriptor: string }): TxnInput {
  return { amountCents: -2500, date: '2026-09-01', accountId: 'acct-x', ...over };
}

/** The three notation variants the owner described, as one merchant. */
const JOES = [
  'SQ *JOES PIZZA #221 ATLANTA GA',
  'SQ *JOES PIZZA #443 ATLANTA GA',
  'SQ *JOES PIZZA ATLANTA GA',
];

describe('the premise: the two keys disagree about identity', () => {
  it('notation variants are DISTINCT signatures but ONE canonical', () => {
    expect(new Set(JOES.map(computeDescriptorSignature)).size).toBe(3);
    expect(new Set(JOES.map((d) => normalizeMerchant(d).canonical))).toEqual(new Set(['Joes Pizza']));
  });

  it('a moving REF number and a moving auth code do the same thing', () => {
    const utility = ['GEORGIA POWER BILLPAY REF 88213', 'GEORGIA POWER BILLPAY REF 90114'];
    expect(new Set(utility.map(computeDescriptorSignature)).size).toBe(2);
    expect(new Set(utility.map((d) => normalizeMerchant(d).canonical)).size).toBe(1);

    const gym = [
      'PURCHASE AUTHORIZED ON 06/12 ORANGETHEORY 8829 ATLANTA GA',
      'PURCHASE AUTHORIZED ON 07/12 ORANGETHEORY 1174 ATLANTA GA',
    ];
    expect(new Set(gym.map(computeDescriptorSignature)).size).toBe(2);
    expect(new Set(gym.map((d) => normalizeMerchant(d).canonical)).size).toBe(1);
  });
});

describe('deriveLearnedRules — the canonical tier', () => {
  it('learns the merchant after two consistent corrections across notation variants', () => {
    const rules = deriveLearnedRules([
      corr('t1', 'dining', JOES[0]!),
      corr('t2', 'dining', JOES[1]!),
    ]);
    const canon = rules.filter((r) => r.merchantCanonical === 'Joes Pizza');
    expect(canon).toHaveLength(1);
    expect(canon[0]!.categoryId).toBe('dining');
    expect(canon[0]!.priority).toBe(LEARNED_CANONICAL_PRIORITY);
    expect(canon[0]!.isLearned).toBe(true);
    expect(canon[0]!.descriptorSignature).toBeNull();
  });

  it('the learned rule files the THIRD, never-seen notation variant', () => {
    const rules = deriveLearnedRules([
      corr('t1', 'dining', JOES[0]!),
      corr('t2', 'dining', JOES[1]!),
    ]);
    const before = categorize(txn({ rawDescriptor: JOES[2]! }), []);
    const after = categorize(txn({ rawDescriptor: JOES[2]! }), rules);
    // Baseline: the generic keyword tier already guesses dining here, so the
    // claim under test is the SOURCE — a user-taught rule, not a generic guess.
    expect(before.source).not.toBe('user-rule');
    expect(after.categoryId).toBe('dining');
    expect(after.source).toBe('user-rule');
    expect(after.matchedRuleId).toBe('learned:canon:Joes Pizza:dining');
    expect(after.needsReview).toBe(false);
  });

  it('teaches a category the merchant tier gets WRONG, across variants', () => {
    // A user who files their local pizza place under 'groceries' (a catering
    // account, say) must have that honoured on the next notation variant.
    const rules = deriveLearnedRules([
      corr('t1', 'groceries', JOES[0]!),
      corr('t2', 'groceries', JOES[1]!),
    ]);
    const out = categorize(txn({ rawDescriptor: JOES[2]! }), rules);
    expect(out.categoryId).toBe('groceries');
    expect(out.source).toBe('user-rule');
  });

  it('one correction is NOT enough (threshold is repetition, not a click)', () => {
    const rules = deriveLearnedRules([corr('t1', 'dining', JOES[0]!)]);
    expect(rules.filter((r) => r.merchantCanonical === 'Joes Pizza')).toHaveLength(0);
  });

  it('a conflicting correction blocks the canonical rule', () => {
    const rules = deriveLearnedRules([
      corr('t1', 'dining', JOES[0]!),
      corr('t2', 'dining', JOES[1]!),
      corr('t3', 'shopping', JOES[2]!),
    ]);
    expect(rules.filter((r) => r.merchantCanonical === 'Joes Pizza')).toHaveLength(0);
  });

  it('two corrections on the SAME transaction are one demonstration, not two', () => {
    const rules = deriveLearnedRules([
      corr('t1', 'shopping', JOES[0]!),
      corr('t1', 'dining', JOES[0]!), // changed their mind — still one txn
    ]);
    expect(rules.filter((r) => r.merchantCanonical === 'Joes Pizza')).toHaveLength(0);
  });

  it('an undo withdraws the demonstration', () => {
    const rules = deriveLearnedRules([
      corr('t1', 'dining', JOES[0]!),
      corr('t2', 'dining', JOES[1]!),
      corr('t2', 'dining', JOES[1]!, -2500, { isUndo: true }),
    ]);
    expect(rules.filter((r) => r.merchantCanonical === 'Joes Pizza')).toHaveLength(0);
  });

  it('the signature tier still wins when both fire (more specific identity)', () => {
    const repeated = 'ORANGETHEORY ATLANTA GA';
    const rules = deriveLearnedRules([
      corr('t1', 'fitness', repeated),
      corr('t2', 'fitness', repeated),
    ]);
    const sig = rules.find((r) => r.descriptorSignature !== null);
    const canon = rules.find((r) => r.merchantCanonical !== null);
    expect(sig).toBeDefined();
    expect(canon).toBeDefined();
    expect(sig!.priority).toBeGreaterThan(canon!.priority);
    expect(LEARNED_PRIORITY).toBeGreaterThan(LEARNED_CANONICAL_PRIORITY);
  });

  it('#44 sign guard holds: an inflow never earns a spend category', () => {
    const rules = deriveLearnedRules([
      corr('t1', 'dining', JOES[0]!, +2500),
      corr('t2', 'dining', JOES[1]!, +2500),
    ]);
    expect(rules.filter((r) => r.merchantCanonical === 'Joes Pizza')).toHaveLength(0);
  });

  it('a learned spend rule is skipped at match time on an opposite-sign row (refund)', () => {
    const rules = deriveLearnedRules([
      corr('t1', 'dining', JOES[0]!),
      corr('t2', 'dining', JOES[1]!),
    ]);
    const refund = categorize(txn({ rawDescriptor: JOES[2]!, amountCents: +2500 }), rules);
    expect(refund.matchedRuleId).not.toBe('learned:canon:Joes Pizza:dining');
  });
});

describe('the refusals — one canonical must never stand for many payees', () => {
  it('AGGREGATE channels are refused, so one Venmo never files every Venmo', () => {
    const venmo = [
      'VENMO PAYMENT 1029384756 JOHN SMITH',
      'VENMO PAYMENT 1938475620 JOHN SMITH',
      'VENMO PAYMENT 5566778899 ACME LANDSCAPING',
    ];
    // premise: all three collapse to the one aggregate canonical
    expect(new Set(venmo.map((d) => normalizeMerchant(d).canonical))).toEqual(new Set(['Venmo']));
    expect(normalizeMerchant(venmo[0]!).aggregate).toBe(true);

    const rules = deriveLearnedRules([
      corr('t1', 'rent', venmo[0]!, -145000),
      corr('t2', 'rent', venmo[1]!, -145000),
    ]);
    expect(rules.filter((r) => r.merchantCanonical !== null)).toHaveLength(0);
    // and the unrelated third payee is NOT filed as rent
    const other = categorize(txn({ rawDescriptor: venmo[2]!, amountCents: -8000 }), rules);
    expect(other.categoryId).not.toBe('rent');
  });

  it('canonicalIsLearnable refuses aggregates, the residue, and glue-only names', () => {
    expect(canonicalIsLearnable('Joes Pizza', false, JOES[0]!)).toBe(true);
    expect(canonicalIsLearnable('Venmo', true, 'VENMO PAYMENT 1 JOHN')).toBe(false);
    expect(canonicalIsLearnable('Unknown Merchant', false, 'POS DEBIT')).toBe(false);
    expect(canonicalIsLearnable('', false, 'X')).toBe(false);
    expect(canonicalIsLearnable('Web Pay', false, 'WEB PAY 12345')).toBe(false);
    expect(canonicalIsLearnable('Ach Debit Ppd', false, 'ACH DEBIT PPD 1112223')).toBe(false);
  });

  it('BUCKET labels the TABLE invented are refused — they are broader than the descriptor', () => {
    // 'Airport Dining' covers a Starbucks, a Peet's and a steakhouse; 'Electric
    // Bill' covers every utility; 'Store Card Purchase' every store card. None
    // of them equals cleanDescriptor(raw), which is the whole test.
    for (const [canonical, raw] of [
      ['Airport Dining', 'HMSHOST-ATLANTA STARBUCKS'],
      ['Electric Bill', 'GEORGIA POWER BILLPAY REF 88213'],
      ['Store Card Purchase', 'STORE CARD PURCHASE 07/15 APPLE CARD 1234'],
    ] as const) {
      expect(normalizeMerchant(raw).canonical, raw).toBe(canonical);
      expect(canonicalIsLearnable(canonical, false, raw), raw).toBe(false);
    }
  });

  it('a bucket canonical never files a third, unrelated outlet', () => {
    const rules = deriveLearnedRules([
      corr('a', 'coffee', 'HMSHOST-ATLANTA STARBUCKS', -600),
      corr('b', 'coffee', 'HMSHOST-DENVER PEETS', -650),
    ]);
    expect(rules.filter((r) => r.merchantCanonical === 'Airport Dining')).toHaveLength(0);
    const third = categorize(txn({ rawDescriptor: 'HMSHOST-LAX STEAKHOUSE', amountCents: -6000 }), rules);
    expect(third.categoryId).not.toBe('coffee');
  });

  it('a proposal MAY key on a bucket label — it asks, it does not file', () => {
    expect(canonicalIsProposable('Electric Bill', false)).toBe(true);
    expect(canonicalIsProposable('Venmo', true)).toBe(false);
    expect(canonicalIsProposable('Web Pay', false)).toBe(false);
    const hints = deriveCorrectionHints(
      { rawDescriptor: 'GEORGIA POWER BILLPAY REF 90114', amountCents: -9500 },
      [corr('t1', 'utilities', 'GEORGIA POWER BILLPAY REF 88213', -9000)],
    );
    expect(hints).toEqual(['utilities']);
  });

  it('two DIFFERENT merchants never merge through the canonical tier', () => {
    const rules = deriveLearnedRules([
      corr('t1', 'dining', JOES[0]!),
      corr('t2', 'dining', JOES[1]!),
    ]);
    const elsewhere = categorize(txn({ rawDescriptor: 'SQ *MARIAS TACOS #900 ATLANTA GA' }), rules);
    expect(elsewhere.matchedRuleId).toBeNull();
  });

  it('an empty history derives nothing (demo goldens stay byte-identical)', () => {
    expect(deriveLearnedRules([])).toEqual([]);
  });
});

describe('deriveCorrectionHints — proposals may key on the canonical at threshold 1', () => {
  it('one correction on a variant proposes the category for the next variant', () => {
    const hints = deriveCorrectionHints(
      { rawDescriptor: JOES[2]!, amountCents: -2500 },
      [corr('t1', 'groceries', JOES[0]!)],
    );
    expect(hints).toEqual(['groceries']);
  });

  it('a conflict across the canonical yields no proposal', () => {
    const hints = deriveCorrectionHints(
      { rawDescriptor: JOES[2]!, amountCents: -2500 },
      [corr('t1', 'groceries', JOES[0]!), corr('t2', 'dining', JOES[1]!)],
    );
    expect(hints).toEqual([]);
  });

  it('the sign guard applies to the proposal too', () => {
    const hints = deriveCorrectionHints(
      { rawDescriptor: JOES[2]!, amountCents: +2500 },
      [corr('t1', 'groceries', JOES[0]!)],
    );
    expect(hints).toEqual([]);
  });

  it('an aggregate descriptor earns no canonical proposal', () => {
    const hints = deriveCorrectionHints(
      { rawDescriptor: 'VENMO PAYMENT 5566778899 ACME LANDSCAPING', amountCents: -8000 },
      [corr('t1', 'rent', 'VENMO PAYMENT 1029384756 JOHN SMITH', -145000)],
    );
    expect(hints).toEqual([]);
  });

  it('an exact signature match still takes precedence over the canonical', () => {
    const hints = deriveCorrectionHints(
      { rawDescriptor: JOES[0]!, amountCents: -2500 },
      [corr('t1', 'dining', JOES[0]!), corr('t2', 'groceries', JOES[1]!)],
    );
    // t1 matches by signature, so the differing t2 (canonical-only) is not consulted
    expect(hints).toEqual(['dining']);
  });
});
