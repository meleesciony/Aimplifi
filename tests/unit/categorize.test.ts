/**
 * Phase 2 acceptance #2 (review rate < 5% over the last 60 seed days) and
 * #3 (contextual rules + priority ordering) and #7 (transfer exclusion).
 */
import { describe, expect, it } from 'vitest';
import { buildSeedData } from '@/lib/seed/build';
import {
  AUTO_FLAGGED_BPS,
  AUTO_SILENT_BPS,
  categorize,
  suggestAlternatives,
  type RuleLike,
  type TxnInput,
} from '@/lib/engine/categorize/pipeline';
import {
  detectTransfers,
  incomeExcludingTransfers,
  spendingExcludingTransfers,
} from '@/lib/engine/categorize/transfers';

const seed = buildSeedData('2026-06-10');

function txn(over: Partial<TxnInput> & { rawDescriptor: string }): TxnInput {
  return {
    amountCents: -5000,
    date: '2026-06-08', // a Monday
    accountId: 'acct-sapphire',
    ...over,
  };
}

describe('contextual rules (Phase 2 acceptance #3)', () => {
  const amazonRules: RuleLike[] = [
    {
      id: 'rule-amazon-small',
      merchantCanonical: 'Amazon',
      minAmountCents: null,
      maxAmountCents: 4000,
      weekendOnly: null,
      weekdayOnly: null,
      accountId: null,
      categoryId: 'household',
      priority: 100,
    },
    {
      id: 'rule-amazon-big',
      merchantCanonical: 'Amazon',
      minAmountCents: 40000,
      maxAmountCents: null,
      weekendOnly: null,
      weekdayOnly: null,
      accountId: null,
      categoryId: 'electronics',
      priority: 100,
    },
  ];

  it('Amazon < $40 → Household; > $400 → Electronics; between → review', () => {
    const small = categorize(txn({ rawDescriptor: 'AMZN Mktp US*2K4XY1', amountCents: -3500 }), amazonRules);
    expect(small.categoryId).toBe('household');
    expect(small.source).toBe('user-rule');
    expect(small.needsReview).toBe(false);

    const big = categorize(txn({ rawDescriptor: 'AMZN Mktp US*2K4XY1', amountCents: -45000 }), amazonRules);
    expect(big.categoryId).toBe('electronics');

    const mid = categorize(txn({ rawDescriptor: 'AMZN Mktp US*2K4XY1', amountCents: -20000 }), amazonRules);
    expect(mid.needsReview).toBe(true);
    expect(mid.categoryId).toBe('uncategorized');
  });

  it('weekend-only rule applies on Saturday, not Monday', () => {
    const weekendRule: RuleLike[] = [
      {
        id: 'rule-sbux-weekend',
        merchantCanonical: 'Starbucks',
        minAmountCents: null,
        maxAmountCents: null,
        weekendOnly: true,
        weekdayOnly: null,
        accountId: null,
        categoryId: 'entertainment',
        priority: 100,
      },
    ];
    const saturday = categorize(
      txn({ rawDescriptor: 'STARBUCKS 800-782-7282', date: '2026-06-13' }),
      weekendRule,
    );
    expect(saturday.categoryId).toBe('entertainment');
    const monday = categorize(
      txn({ rawDescriptor: 'STARBUCKS 800-782-7282', date: '2026-06-08' }),
      weekendRule,
    );
    expect(monday.categoryId).toBe('coffee'); // merchant default (#163: Starbucks = coffee)
  });

  it('account-scoped rule applies only on that account', () => {
    const jointRule: RuleLike[] = [
      {
        id: 'rule-walmart-joint',
        merchantCanonical: 'Walmart',
        minAmountCents: null,
        maxAmountCents: null,
        weekendOnly: null,
        weekdayOnly: null,
        accountId: 'acct-joint',
        categoryId: 'groceries',
        priority: 100,
      },
    ];
    expect(
      categorize(txn({ rawDescriptor: 'WM SUPERCENTER #2841', accountId: 'acct-joint' }), jointRule)
        .categoryId,
    ).toBe('groceries');
    expect(
      categorize(txn({ rawDescriptor: 'WM SUPERCENTER #2841', accountId: 'acct-sapphire' }), jointRule)
        .categoryId,
    ).toBe('shopping');
  });

  it('priority: user rule beats merchant default beats fallback suggestion', () => {
    const lowRule: RuleLike = {
      id: 'low', merchantCanonical: 'Target', minAmountCents: null, maxAmountCents: null,
      weekendOnly: null, weekdayOnly: null, accountId: null, categoryId: 'household', priority: 100,
    };
    const highRule: RuleLike = { ...lowRule, id: 'high', categoryId: 'electronics', priority: 200 };
    const result = categorize(txn({ rawDescriptor: 'TARGET T-1893 ATLANTA GAUS' }), [lowRule, highRule]);
    expect(result.categoryId).toBe('electronics'); // higher priority wins
    expect(result.matchedRuleId).toBe('high');
    // no rules → merchant default
    expect(categorize(txn({ rawDescriptor: 'TARGET T-1893 ATLANTA GAUS' })).source).toBe('merchant-default');
    // unknown merchant → fallback, review
    expect(categorize(txn({ rawDescriptor: 'TOTALLY UNKNOWN VENDOR 991' })).source).toBe('fallback');
  });

  it('suggestAlternatives returns 3 distinct categories', () => {
    const alts = suggestAlternatives(txn({ rawDescriptor: 'ZELLE PAYMENT TO J. PARK' }));
    expect(alts).toHaveLength(3);
    expect(new Set(alts).size).toBe(3);
  });
});

describe('review rate on the most recent 60 seed days (Phase 2 acceptance #2: <5%)', () => {
  const windowTxns = seed.transactions.filter((t) => t.date > '2026-04-11' && t.date <= '2026-06-10');

  it('auto-applies ≥95% silently or flagged; prints the actual rate and the review list', () => {
    const results = windowTxns.map((t) => ({
      txn: t,
      out: categorize(
        {
          rawDescriptor: t.rawDescriptor,
          amountCents: t.amountCents,
          date: t.date,
          accountId: t.accountId,
          isTransfer: t.isTransfer,
        },
        [],
      ),
    }));
    const review = results.filter((r) => r.out.needsReview);
    const rate = review.length / results.length;
    console.log(
      `[review-rate] ${review.length}/${results.length} = ${(rate * 100).toFixed(2)}% need review`,
    );
    for (const r of review) {
      console.log(`  needsReview: ${r.txn.date} ${r.txn.rawDescriptor} (${r.txn.amountCents}¢)`);
    }
    expect(results.length).toBeGreaterThan(100); // sanity: real volume
    expect(rate).toBeLessThan(0.05);
  });

  it('payroll auto-categorizes as income, silently (≥ AUTO_SILENT)', () => {
    const out = categorize(
      txn({ rawDescriptor: 'ACH DEPOSIT ACME ANALYTICS PAYROLL', amountCents: 245000, accountId: 'acct-checking' }),
    );
    expect(out.categoryId).toBe('income');
    expect(out.confidenceBps).toBeGreaterThanOrEqual(AUTO_SILENT_BPS);
    expect(out.needsReview).toBe(false);
  });

  it('the 7000–8999 band gets the subtle AI badge', () => {
    expect(AUTO_FLAGGED_BPS).toBeLessThan(AUTO_SILENT_BPS);
  });
});

describe('transfer detection (Phase 2 acceptance #7)', () => {
  const transferIds = detectTransfers(seed.transactions);

  it('flags every seeded savings transfer and card payment as a transfer', () => {
    const shouldBeTransfers = seed.transactions.filter((t) => t.isTransfer);
    const missed = shouldBeTransfers.filter((t) => !transferIds.has(t.id));
    expect(missed.map((t) => t.rawDescriptor)).toEqual([]);
  });

  it('does NOT flag payroll, rent, or ordinary spend', () => {
    const payroll = seed.transactions.find((t) => t.rawDescriptor.includes('PAYROLL'))!;
    const rent = seed.transactions.find((t) => t.rawDescriptor.includes('RENT'))!;
    expect(transferIds.has(payroll.id)).toBe(false);
    expect(transferIds.has(rent.id)).toBe(false);
  });

  it('a month’s income/spending excludes transfers entirely', () => {
    const may = seed.transactions.filter(
      (t) => t.date >= '2026-05-01' && t.date < '2026-06-01' && t.status === 'POSTED',
    );
    const ids = detectTransfers(may);
    const income = incomeExcludingTransfers(may, ids);
    // May 2026 has THREE biweekly paydays (Fri 05-01, 05-15, 05-29 — anchored
    // on 06-12) plus the $50.00 Amazon refund: 3 × 245,000 + 5,000 = 740,000.
    expect(income).toBe(245000 * 3 + 5000);
    const spend = spendingExcludingTransfers(may, ids);
    const cardPayments = may.filter(
      (t) => t.rawDescriptor.match(/EPAY|STORE CARD PAYMENT/) && t.amountCents < 0,
    );
    // spending must not contain the card payments (they'd double-count card spend)
    const totalOutflow = may.filter((t) => t.amountCents < 0).reduce((s, t) => s - t.amountCents, 0);
    expect(spend).toBeLessThan(totalOutflow);
    expect(cardPayments.length).toBeGreaterThan(0);
  });
});

describe('provider category hint — Plaid PFC passthrough (DECISIONS #155)', () => {
  // A confident, sign-appropriate hint mapped to our taxonomy. The pipeline treats it
  // as opaque; the Plaid→Pulse mapping itself is tested in plaid-map.test.ts.
  const diningHint = { categoryId: 'dining', confidenceBps: 8800 };

  it('rescues an UNKNOWN merchant from review using the hint (auto-filed, AI badge)', () => {
    const bare = categorize(txn({ rawDescriptor: 'ACME WIDGETS LLC', amountCents: -4200 }));
    // Without a hint this is an unknown merchant → review.
    expect(bare.needsReview).toBe(true);
    expect(bare.categoryId).toBe('uncategorized');

    const rescued = categorize(
      txn({ rawDescriptor: 'ACME WIDGETS LLC', amountCents: -4200, providerCategoryHint: diningHint }),
    );
    expect(rescued.categoryId).toBe('dining');
    expect(rescued.confidenceBps).toBe(8800);
    expect(rescued.needsReview).toBe(false);
    expect(rescued.aiBadge).toBe(true); // below AUTO_SILENT → visible, correctable guess
    expect(rescued.source).toBe('provider-category');
  });

  it('does NOT override a CONFIDENT merchant match', () => {
    // Starbucks is a known merchant (dining, ≥ AUTO_FLAGGED). A disagreeing hint is ignored.
    const shoppingHint = { categoryId: 'shopping', confidenceBps: 8800 };
    const r = categorize(
      txn({ rawDescriptor: 'STARBUCKS STORE 123', amountCents: -575, providerCategoryHint: shoppingHint }),
    );
    expect(r.categoryId).toBe('coffee'); // #163: Starbucks = coffee
    expect(r.source).toBe('merchant-default');
  });

  it('does NOT override a user rule', () => {
    const rule: RuleLike[] = [
      {
        id: 'r-widget',
        merchantCanonical: 'Acme Widgets Llc',
        minAmountCents: null,
        maxAmountCents: null,
        weekendOnly: null,
        weekdayOnly: null,
        accountId: null,
        categoryId: 'household',
        priority: 100,
      },
    ];
    const r = categorize(
      txn({ rawDescriptor: 'ACME WIDGETS LLC', amountCents: -4200, providerCategoryHint: diningHint }),
      rule,
    );
    expect(r.categoryId).toBe('household');
    expect(r.source).toBe('user-rule');
  });

  it('does NOT override a transfer', () => {
    const r = categorize(
      txn({ rawDescriptor: 'ONLINE TRANSFER TO SAVINGS', amountCents: -50000, providerCategoryHint: diningHint }),
    );
    expect(r.categoryId).toBe('transfer');
    expect(r.source).toBe('transfer');
  });

  it('does NOT rescue a deliberate AGGREGATE (Zelle / Venmo / Check) — they stay in review', () => {
    for (const rawDescriptor of ['ZELLE PAYMENT TO JOHN', 'VENMO PAYMENT 123', 'CHECK # 4021']) {
      const r = categorize(txn({ rawDescriptor, amountCents: -4200, providerCategoryHint: diningHint }));
      expect(r.categoryId).toBe('uncategorized');
      expect(r.needsReview).toBe(true);
      expect(r.source).not.toBe('provider-category');
    }
  });

  it('a $0 amount is never rescued (sign guard has no matching branch)', () => {
    const incomeHint = { categoryId: 'paycheck', confidenceBps: 8000 };
    for (const providerCategoryHint of [diningHint, incomeHint]) {
      const r = categorize(txn({ rawDescriptor: 'ACME WIDGETS LLC', amountCents: 0, providerCategoryHint }));
      expect(r.categoryId).toBe('uncategorized');
      expect(r.needsReview).toBe(true);
      expect(r.source).not.toBe('provider-category');
    }
  });

  it('a hint does NOT rescue an amount-banded-ambiguous row (user intent outranks the hint)', () => {
    // The user's amount-banded rule matches this merchant/context but the amount falls
    // outside the band → the user declared this ambiguous → review. A confident hint
    // must NOT override that (the amount-band branch returns before the hint tier).
    const bandedRule: RuleLike[] = [
      {
        id: 'r-banded',
        merchantCanonical: 'Acme Widgets Llc',
        minAmountCents: 100,
        maxAmountCents: 200,
        weekendOnly: null,
        weekdayOnly: null,
        accountId: null,
        categoryId: 'household',
        priority: 100,
      },
    ];
    const r = categorize(
      txn({ rawDescriptor: 'ACME WIDGETS LLC', amountCents: -4200, providerCategoryHint: diningHint }),
      bandedRule,
    );
    expect(r.categoryId).toBe('uncategorized');
    expect(r.needsReview).toBe(true);
    expect(r.source).not.toBe('provider-category');
  });

  it('sign guard (#44): a spend hint on an INFLOW is ignored (not booked as spend)', () => {
    const r = categorize(
      txn({ rawDescriptor: 'ACME WIDGETS LLC', amountCents: 4200, providerCategoryHint: diningHint }),
    );
    expect(r.categoryId).toBe('uncategorized');
    expect(r.needsReview).toBe(true);
  });

  it('sign guard (#44): an INCOME hint on an inflow IS applied; on an outflow is ignored', () => {
    const incomeHint = { categoryId: 'paycheck', confidenceBps: 8000 };
    const inflow = categorize(
      txn({ rawDescriptor: 'ACME WIDGETS LLC', amountCents: 4200, providerCategoryHint: incomeHint }),
    );
    expect(inflow.categoryId).toBe('paycheck');
    expect(inflow.source).toBe('provider-category');

    const outflow = categorize(
      txn({ rawDescriptor: 'ACME WIDGETS LLC', amountCents: -4200, providerCategoryHint: incomeHint }),
    );
    expect(outflow.categoryId).toBe('uncategorized'); // an outflow is never booked as income
    expect(outflow.needsReview).toBe(true);
  });

  it('ignores a hint below the auto-file threshold, or with a transfer / bogus / uncategorized id', () => {
    const below = categorize(
      txn({ rawDescriptor: 'ACME WIDGETS LLC', amountCents: -4200, providerCategoryHint: { categoryId: 'dining', confidenceBps: AUTO_FLAGGED_BPS - 1 } }),
    );
    expect(below.needsReview).toBe(true);
    for (const bad of ['transfer', 'uncategorized', 'not-a-real-category']) {
      const r = categorize(
        txn({ rawDescriptor: 'ACME WIDGETS LLC', amountCents: -4200, providerCategoryHint: { categoryId: bad, confidenceBps: 8800 } }),
      );
      expect(r.categoryId).toBe('uncategorized');
      expect(r.needsReview).toBe(true);
    }
  });

  it('no hint → behaviour is byte-identical to today (unknown → review)', () => {
    const withUndef = categorize(txn({ rawDescriptor: 'ACME WIDGETS LLC', amountCents: -4200, providerCategoryHint: null }));
    const without = categorize(txn({ rawDescriptor: 'ACME WIDGETS LLC', amountCents: -4200 }));
    expect(withUndef).toEqual(without);
    expect(without.source).toBe('fallback');
  });

  it('AUTO_SILENT boundary: a hint ≥ AUTO_SILENT would auto-file without the AI badge', () => {
    // Documents the pipeline contract; the Plaid mapper caps confidence < AUTO_SILENT
    // so in practice a PFC hint always carries the badge.
    const r = categorize(
      txn({ rawDescriptor: 'ACME WIDGETS LLC', amountCents: -4200, providerCategoryHint: { categoryId: 'dining', confidenceBps: AUTO_SILENT_BPS } }),
    );
    expect(r.source).toBe('provider-category');
    expect(r.aiBadge).toBe(false);
    expect(r.needsReview).toBe(false);
  });
});
