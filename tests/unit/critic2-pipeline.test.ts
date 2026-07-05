/**
 * Adversarial pipeline scenarios from the Phase 2 Hostile Critic (cycle 1),
 * kept as permanent regressions. The former `FINDING:` probes asserted the
 * defective behavior; after the cycle-2 fixes (anchored transfer patterns,
 * scope-aware band-gap rule, whitespace fallback) they now assert the
 * CORRECT behavior.
 */
import { describe, expect, it } from 'vitest';
import { categorize, ruleMatches, type RuleLike, type TxnInput } from '@/lib/engine/categorize/pipeline';
import { detectTransfers } from '@/lib/engine/categorize/transfers';

const txn = (over: Partial<TxnInput> & { rawDescriptor: string }): TxnInput => ({
  amountCents: -5000,
  date: '2026-06-08', // Monday
  accountId: 'acct-sapphire',
  ...over,
});

describe('critic: 10 messiest seed descriptors through the LIVE pipeline', () => {
  const cases: [string, string, string][] = [
    ['SQ *BLUE BOTTLE 0042 OAK', 'Blue Bottle Coffee', 'coffee'],
    ['TST* HATTIE BS - ATL', "Hattie B's", 'dining'],
    ['AMZN Mktp US*2K4XY1', 'Amazon', 'shopping'],
    ['PAYPAL *SPOTIFYUSA', 'Spotify', 'entertainment'],
    ['HMSHOST-ATL-T4-POS118', 'Airport Dining', 'dining'],
    ['COSTCO GAS #1234 ATLANTA', 'Costco Gas', 'fuel'],
    ['COSTCO WHSE #1234 ATLANTA', 'Costco', 'groceries'],
    ['UBER *TRIP HELP.UBER.COM', 'Uber', 'transport'],
    // Phase 3a: food-delivery — the KNOWN entry now agrees with the generic table
    ['UBER *EATS PENDING.UBER.CO', 'Uber Eats', 'food-delivery'],
    ['GOOGLE *YOUTUBEPREMIUM g.co', 'YouTube Premium', 'entertainment'],
  ];
  it.each(cases)('"%s" → %s / %s, auto-applied silently', (raw, merchant, category) => {
    const out = categorize(txn({ rawDescriptor: raw }));
    expect(out.merchantCanonical).toBe(merchant);
    expect(out.categoryId).toBe(category);
    expect(out.needsReview).toBe(false);
    expect(out.confidenceBps).toBeGreaterThanOrEqual(9000);
  });
});

describe('critic: invented adversarial descriptors', () => {
  it('lowercase variant "sq *blue bottle 0042 oak" still resolves (patterns are /i)', () => {
    const out = categorize(txn({ rawDescriptor: 'sq *blue bottle 0042 oak' }));
    expect(out.merchantCanonical).toBe('Blue Bottle Coffee');
    expect(out.needsReview).toBe(false);
  });

  it('an SQ* merchant CONTAINING "NETFLIX" is NOT routed to Netflix (anchored pattern)', () => {
    const out = categorize(txn({ rawDescriptor: 'SQ *NETFLIX AND CHILL BAR ATL' }));
    expect(out.merchantCanonical).not.toBe('Netflix');
    expect(out.needsReview).toBe(true); // unknown → review, correct
  });

  it('unicode descriptor survives cleanup without crashing', () => {
    const out = categorize(txn({ rawDescriptor: 'CAFÉ MÜNCHEN 4521 ATL' }));
    expect(out.needsReview).toBe(true);
    expect(out.merchantCanonical.length).toBeGreaterThan(0);
  });

  it('whitespace-only descriptor gets a usable fallback canonical (critic F9, fixed)', () => {
    const out = categorize(txn({ rawDescriptor: '   ' }));
    expect(out.merchantCanonical).toBe('Unknown Merchant');
    expect(out.needsReview).toBe(true);
  });

  it('"T-MOBILE PREPAY REFILL" is NOT a transfer — word-bounded EPAY pattern (critic F4, fixed)', () => {
    const out = categorize(txn({ rawDescriptor: 'T-MOBILE PREPAY REFILL 800-937-8997' }));
    expect(out.categoryId).not.toBe('transfer'); // the F4 essence — unchanged
    // Phase 3a: T-Mobile is now a KNOWN merchant, so instead of unknown→review this
    // files correctly (a strictly stronger outcome than the review routing it locked).
    expect(out.merchantCanonical).toBe('T-Mobile');
    expect(out.categoryId).toBe('phone');
    expect(out.needsReview).toBe(false);
  });

  it('"GIFT CARD PAYMENT - STARBUCKS.COM" is NOT a transfer (critic F4, fixed)', () => {
    const out = categorize(txn({ rawDescriptor: 'GIFT CARD PAYMENT - STARBUCKS.COM' }));
    expect(out.categoryId).not.toBe('transfer');
    expect(out.needsReview).toBe(true);
  });

  it('categorize() and detectTransfers() share ONE transfer pattern — "NETFLIX EPAY" agrees in both (critic F4, fixed)', () => {
    // Netflix-the-merchant wins in the normalizer (listed first) → expense…
    const out = categorize(txn({ rawDescriptor: 'NETFLIX EPAY 866-579-7172' }));
    // …and the word-bounded \bEPAY\b still flags the descriptor in pair-less
    // descriptor matching. The modules now share TRANSFER_DESCRIPTOR, so any
    // residual divergence is a deliberate ordering decision in one table —
    // assert the user-visible invariant: the txn is NEVER silently dropped
    // from review/expense without the transfer flag agreeing.
    const ids = detectTransfers([
      { id: 't1', accountId: 'a', date: '2026-06-08', amountCents: -1799, rawDescriptor: 'NETFLIX EPAY 866-579-7172' },
    ]);
    expect(ids.has('t1')).toBe(out.categoryId === 'transfer');
  });

  it('"GEICO AUTOPAY" is a real insurance premium in BOTH modules (critic F4, fixed)', () => {
    const ids = detectTransfers([
      { id: 'g1', accountId: 'a', date: '2026-06-08', amountCents: -14250, rawDescriptor: 'GEICO AUTOPAY 800-841-3000' },
    ]);
    expect(ids.has('g1')).toBe(false);
    expect(categorize(txn({ rawDescriptor: 'GEICO AUTOPAY 800-841-3000' })).categoryId).toBe('insurance');
  });
});

describe('critic: rules-engine edge cases by hand (DECISIONS #17)', () => {
  const rule = (over: Partial<RuleLike>): RuleLike => ({
    id: 'r1',
    merchantCanonical: 'Amazon',
    minAmountCents: null,
    maxAmountCents: null,
    weekendOnly: null,
    weekdayOnly: null,
    accountId: null,
    categoryId: 'household',
    priority: 100,
    ...over,
  });

  it('min === max === |amount| matches (inclusive bounds)', () => {
    const r = rule({ minAmountCents: 4000, maxAmountCents: 4000 });
    expect(ruleMatches(r, txn({ rawDescriptor: 'AMZN Mktp US*2K4XY1', amountCents: -4000 }), 'Amazon')).toBe(true);
    expect(ruleMatches(r, txn({ rawDescriptor: 'AMZN Mktp US*2K4XY1', amountCents: -4001 }), 'Amazon')).toBe(false);
  });

  it('weekendOnly AND weekdayOnly both true → rule can never match (and silently so)', () => {
    const r = rule({ weekendOnly: true, weekdayOnly: true });
    expect(ruleMatches(r, txn({ rawDescriptor: 'AMZN Mktp US*2K4XY1', date: '2026-06-08' }), 'Amazon')).toBe(false); // Mon
    expect(ruleMatches(r, txn({ rawDescriptor: 'AMZN Mktp US*2K4XY1', date: '2026-06-13' }), 'Amazon')).toBe(false); // Sat
  });

  it('a rule on "Costco" never touches "Costco Gas" (normalizer keeps them distinct)', () => {
    const r = rule({ merchantCanonical: 'Costco', categoryId: 'groceries' });
    const out = categorize(txn({ rawDescriptor: 'COSTCO GAS #1234 ATLANTA' }), [r]);
    expect(out.categoryId).toBe('fuel'); // merchant default, rule correctly skipped
    expect(out.matchedRuleId).toBeNull();
  });

  it('an amount-banded rule scoped to ANOTHER account does NOT poison this account (critic F5, fixed)', () => {
    const scoped = rule({ maxAmountCents: 4000, accountId: 'acct-joint' });
    const out = categorize(
      txn({ rawDescriptor: 'AMZN Mktp US*2K4XY1', amountCents: -3500, accountId: 'acct-sapphire' }),
      [scoped],
    );
    // the band lives on another account — merchant default applies here
    expect(out.needsReview).toBe(false);
    expect(out.categoryId).toBe('shopping');
    // …while ON the scoped account, the band-gap rule still routes gaps to review
    const onJointInGap = categorize(
      txn({ rawDescriptor: 'AMZN Mktp US*2K4XY1', amountCents: -20000, accountId: 'acct-joint' }),
      [scoped],
    );
    expect(onJointInGap.needsReview).toBe(true);
  });

  it('weekend-scoped banded rule leaves weekdays to the merchant default (critic F5, fixed)', () => {
    const weekendBand = rule({ maxAmountCents: 4000, weekendOnly: true });
    const monday = categorize(
      txn({ rawDescriptor: 'AMZN Mktp US*2K4XY1', amountCents: -3500, date: '2026-06-08' }),
      [weekendBand],
    );
    expect(monday.needsReview).toBe(false);
    expect(monday.categoryId).toBe('shopping');
  });

  it('equal-priority rules: first in array wins (stable sort) — order-dependent, undocumented', () => {
    const a = rule({ id: 'a', categoryId: 'household' });
    const b = rule({ id: 'b', categoryId: 'electronics' });
    const out = categorize(txn({ rawDescriptor: 'AMZN Mktp US*2K4XY1' }), [a, b]);
    expect(out.matchedRuleId).toBe('a');
  });
});
