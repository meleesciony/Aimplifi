/**
 * User-authored keyword match keys (TASKS O.13a) — the owner's named ask:
 *
 *   "You have the ability to change things like 'contains tjmax'. Because the
 *    card number and other numbers always change."
 *
 * The happy path here is one line; the FAILURE DIRECTIONS are the file. A rule
 * files money without asking again, so the tests that matter are the ones that
 * prove it matches too LITTLE rather than too much:
 *
 *   - an EMPTY key matches nothing, even though a keyword rule carries
 *     `merchantCanonical: null` which means "any merchant" in `ruleMatches` —
 *     the file-everything trap, and the reason this file exists;
 *   - matching is LITERAL, so `tjmaxx` does not match `TJ MAXX`: an under-match
 *     leaves the row in review where the reader sees it;
 *   - every keyword must be present, so adding one can only narrow;
 *   - an absent key changes nothing about existing rules.
 */
import { describe, expect, it } from 'vitest';

import {
  KEYWORD_RULE_PRIORITY,
  MIN_KEYWORD_LENGTH,
  decodeKeywordGroups,
  decodeKeywords,
  encodeKeywordGroups,
  encodeKeywords,
  keywordGroupsMatch,
  keywordSpecificity,
  keywordsMatch,
  longestKeywordLength,
  parseKeywordGroups,
  parseKeywords,
} from '@/lib/engine/categorize/keyword-rule';
import { toRuleLike, toRuleLikes } from '@/server/rules';
import { type RuleLike, categorize } from '@/lib/engine/categorize/pipeline';

/** The owner's real statement text, from his Simplifi screenshot. */
const TJMAXX = 'tjmaxx 0181 0966';
/** The SAME shop next month: store and sequence numbers have both moved. */
const TJMAXX_NEXT = 'TJMAXX 0499 1122';

function rule(over: Partial<RuleLike>): RuleLike {
  return {
    id: 'r1',
    merchantCanonical: null,
    minAmountCents: null,
    maxAmountCents: null,
    weekendOnly: null,
    weekdayOnly: null,
    accountId: null,
    categoryId: 'clothing',
    priority: 110,
    ...over,
  };
}

const TXN = { amountCents: -2198, date: '2026-07-27', accountId: 'acct-1' };

describe('parseKeywords', () => {
  it('splits on commas OR whitespace, folds case, drops blanks, keeps first-seen order', () => {
    expect(parseKeywords('tjmaxx, 0181  0966')).toEqual(['tjmaxx', '0181', '0966']);
    expect(parseKeywords('  TJMaxx\t0181\n')).toEqual(['tjmaxx', '0181']);
    expect(parseKeywords(',,,   ')).toEqual([]);
  });

  it('collapses duplicates so one condition is not counted twice', () => {
    expect(parseKeywords('tjmaxx tjmaxx TJMAXX')).toEqual(['tjmaxx']);
  });
});

describe('the storage codec', () => {
  it('round-trips, and a null/blank column decodes to the empty key', () => {
    const keys = parseKeywords('tjmaxx 0181');
    expect(decodeKeywords(encodeKeywords(keys))).toEqual(keys);
    expect(decodeKeywords(null)).toEqual([]);
    expect(decodeKeywords(undefined)).toEqual([]);
    expect(decodeKeywords('')).toEqual([]);
    expect(encodeKeywords([])).toBe('');
  });
});

describe('keywordsMatch — what it REFUSES', () => {
  it('refuses an EMPTY key, even against a descriptor containing everything', () => {
    // The whole point: `merchantCanonical: null` already means "any merchant", so
    // an empty key must not become a file-everything rule.
    expect(keywordsMatch([], TJMAXX)).toBe(false);
    expect(keywordsMatch([], '')).toBe(false);
  });

  it('requires EVERY keyword, so adding one can only narrow the match', () => {
    expect(keywordsMatch(['tjmaxx', '0181'], TJMAXX)).toBe(true);
    expect(keywordsMatch(['tjmaxx', '0181'], TJMAXX_NEXT)).toBe(false);
  });

  it('matches LITERALLY — `tjmaxx` is not `TJ MAXX` (deliberate under-match)', () => {
    expect(keywordsMatch(['tjmaxx'], 'TJ MAXX #0181 ATLANTA GA')).toBe(false);
    expect(keywordsMatch(['tj', 'maxx'], 'TJ MAXX #0181 ATLANTA GA')).toBe(true);
  });
});

describe('keywordsMatch — what it accepts', () => {
  it("holds across the moving numbers, which is the owner's entire request", () => {
    expect(keywordsMatch(['tjmaxx'], TJMAXX)).toBe(true);
    expect(keywordsMatch(['tjmaxx'], TJMAXX_NEXT)).toBe(true);
  });

  it('is case-insensitive on both sides and order-free', () => {
    expect(keywordsMatch(['TJMAXX'], TJMAXX)).toBe(true);
    expect(keywordsMatch(['0966', 'tjmaxx'], TJMAXX)).toBe(true);
  });

  it('matches inside a longer token', () => {
    expect(keywordsMatch(['amzn'], 'AMZN MKTP US*2X4Y5')).toBe(true);
  });
});

describe('keywordSpecificity — deterministic precedence between two keyword rules', () => {
  it('ranks more keywords above fewer, and longer text above shorter at equal count', () => {
    expect(keywordSpecificity(['costco', 'gas'])).toBeGreaterThan(keywordSpecificity(['costco']));
    expect(keywordSpecificity(['costco gas'])).toBeGreaterThan(keywordSpecificity(['costco']));
    expect(keywordSpecificity([])).toBe(0);
  });
});

describe('the pipeline honours a typed key', () => {
  it('files a matching row as a user rule, and names the rule that did it', () => {
    const out = categorize({ ...TXN, rawDescriptor: TJMAXX_NEXT }, [
      rule({ id: 'kw-1', matchKeywords: ['tjmaxx'] }),
    ]);
    expect(out.categoryId).toBe('clothing');
    expect(out.source).toBe('user-rule');
    expect(out.matchedRuleId).toBe('kw-1');
  });

  it('leaves a non-matching row alone', () => {
    const out = categorize({ ...TXN, rawDescriptor: 'MACYS LENOX SQUARE' }, [
      rule({ id: 'kw-1', matchKeywords: ['tjmaxx'] }),
    ]);
    expect(out.source).not.toBe('user-rule');
    expect(out.matchedRuleId).toBeNull();
  });

  it('NEVER files everything when the key is empty and no other condition is set', () => {
    // Fail-old: without the `keywordsMatch([]) === false` refusal this rule has
    // no conditions at all and files every transaction in the app.
    for (const rawDescriptor of [TJMAXX, 'MACYS LENOX SQUARE', 'PUBLIX #1234', 'Venmo']) {
      const out = categorize({ ...TXN, rawDescriptor }, [rule({ id: 'kw-empty', matchKeywords: [] })]);
      expect(out.source).not.toBe('user-rule');
      expect(out.matchedRuleId).toBeNull();
    }
  });

  it('ANDs the key with the existing contextual conditions', () => {
    const banded = rule({ id: 'kw-1', matchKeywords: ['tjmaxx'], minAmountCents: 5000 });
    // $21.98 is below the $50.00 floor, so the key matching is not enough.
    expect(categorize({ ...TXN, rawDescriptor: TJMAXX_NEXT }, [banded]).source).not.toBe('user-rule');
    expect(
      categorize({ ...TXN, amountCents: -9900, rawDescriptor: TJMAXX_NEXT }, [banded]).matchedRuleId,
    ).toBe('kw-1');
  });

  it('leaves a rule with NO key byte-identical to before (absent ≠ empty)', () => {
    // "Macy's" is what the normalizer produces for this descriptor — verified by
    // execution, not assumed. (It produced 'Macys Lenox Square' until the O.13
    // brand-coverage fix taught the table the plural spelling, and this fixture
    // failing on that change is the test doing its job.)
    const merchantRule = rule({ id: 'm-1', merchantCanonical: "Macy's", priority: 100 });
    const out = categorize({ ...TXN, rawDescriptor: 'MACYS LENOX SQUARE' }, [merchantRule]);
    expect(out.matchedRuleId).toBe('m-1');
    expect(out.source).toBe('user-rule');
  });
});

/**
 * WHY THE FEATURE EXISTS — and it is not the owner's own example.
 *
 * `tjmaxx 0181 0966` and `TJMAXX 0499 1122` BOTH already normalize to the known
 * merchant `Tjmaxx` and auto-file as clothing without review (measured), so the
 * headline example in his screenshot is not a live defect here.
 *
 * The live defect is two rows down his own dashboard screenshot: one restaurant
 * reaches him under two descriptors that produce two DIFFERENT canonicals, so no
 * derived key — merchant canonical or descriptor signature — can ever unify them,
 * and they land in two different categories AND two different review states. One
 * typed keyword does unify them. That is the whole argument for O.13a, so it is
 * the case this file locks.
 */
describe('the class no DERIVED key can fix', () => {
  const TOAST = 'Tst*mirko Pasta Buckhead'; // Toast POS prefix
  const PLAIN = 'MIRKO PASTA'; // the same restaurant, billed directly

  it('produces two different canonicals for one restaurant, so a merchant rule cannot span it', () => {
    const a = categorize({ ...TXN, rawDescriptor: TOAST });
    const b = categorize({ ...TXN, rawDescriptor: PLAIN });
    expect(a.merchantCanonical).not.toBe(b.merchantCanonical);
    // And they disagree about the answer, which is what the reader sees.
    expect(a.categoryId).not.toBe(b.categoryId);
    expect(b.needsReview).toBe(true);
  });

  it('files both identically under ONE typed keyword', () => {
    const kw = [rule({ id: 'kw-mirko', matchKeywords: parseKeywords('mirko'), categoryId: 'dining' })];
    for (const rawDescriptor of [TOAST, PLAIN]) {
      const out = categorize({ ...TXN, rawDescriptor }, kw);
      expect(out.categoryId).toBe('dining');
      expect(out.matchedRuleId).toBe('kw-mirko');
      expect(out.needsReview).toBe(false);
    }
  });
});

/**
 * The STORED half: mapping a row to a rule, and precedence (O.13a).
 *
 * `toRuleLike` is where the feature's worst possible bug lives. A keyword rule
 * carries no merchantId, and in `RuleLike` a null `merchantCanonical` means "ANY
 * merchant" — so a row that ANNOUNCED a keyword key and has none left would file
 * every transaction in the account. That is the same trap the orphaned-merchant
 * case already guards, and it gets the same answer: refuse the row.
 */
describe('toRuleLike — the stored keyword key', () => {
  const base = {
    id: 'r1',
    merchantId: null,
    minAmountCents: null,
    maxAmountCents: null,
    weekendOnly: null,
    weekdayOnly: null,
    accountId: null,
    categoryId: 'clothing',
    priority: KEYWORD_RULE_PRIORITY,
  };

  it('decodes the stored key onto the rule', () => {
    const out = toRuleLike({ ...base, matchKeywords: 'tjmaxx 0181' }, new Map());
    expect(out?.matchKeywords).toEqual(['tjmaxx', '0181']);
  });

  it('REFUSES a row that declares a keyword key and has none left', () => {
    // Fail-old: without this the rule has no merchant, no keywords and no other
    // condition — it matches every transaction the pipeline ever sees.
    expect(toRuleLike({ ...base, matchKeywords: '' }, new Map())).toBeNull();
    expect(toRuleLike({ ...base, matchKeywords: '   ' }, new Map())).toBeNull();
  });

  it('leaves a pre-O.13a row (no key at all) exactly as it was', () => {
    const out = toRuleLike({ ...base, priority: 100, matchKeywords: null }, new Map());
    expect(out).not.toBeNull();
    expect(out!.matchKeywords).toBeNull();
  });
});

describe('precedence between rules that both match', () => {
  function kw(id: string, words: string, categoryId: string) {
    return rule({ id, matchKeywords: parseKeywords(words), categoryId, priority: KEYWORD_RULE_PRIORITY });
  }

  it('a TYPED key outranks an explicit merchant rule on the same row', () => {
    const merchantRule = rule({ id: 'm-1', merchantCanonical: 'Tjmaxx', categoryId: 'shopping', priority: 100 });
    const out = categorize({ ...TXN, rawDescriptor: TJMAXX }, [merchantRule, kw('kw-1', 'tjmaxx', 'clothing')]);
    expect(out.categoryId).toBe('clothing');
    expect(out.matchedRuleId).toBe('kw-1');
  });

  it('the MORE SPECIFIC key wins, in either input order', () => {
    const broad = kw('kw-broad', 'costco', 'groceries');
    const narrow = kw('kw-narrow', 'costco gas', 'fuel');
    const txn = { ...TXN, rawDescriptor: 'COSTCO GAS #0455 ATLANTA GA' };
    expect(categorize(txn, [broad, narrow]).matchedRuleId).toBe('kw-narrow');
    expect(categorize(txn, [narrow, broad]).matchedRuleId).toBe('kw-narrow');
  });

  it('two equally specific keys resolve by id, not by input order', () => {
    const a = kw('kw-aaa', 'pasta', 'dining');
    const b = kw('kw-bbb', 'mirko', 'groceries');
    const txn = { ...TXN, rawDescriptor: 'MIRKO PASTA' };
    expect(categorize(txn, [a, b]).matchedRuleId).toBe('kw-aaa');
    expect(categorize(txn, [b, a]).matchedRuleId).toBe('kw-aaa');
  });
});

/**
 * THE CRITIC FINDINGS, locked (TASKS O.13a, hostile-critic cycle 1: 2 P0 + 7 P1).
 *
 * Each case below failed on the shipped code and was reproduced by a critic before
 * being fixed, so each is a fail-old lock rather than a restatement of the fix.
 */
describe('a typed key takes the #44 sign check (critic P0-1)', () => {
  const INCOME_RULE = () =>
    rule({ id: 'kw-income', matchKeywords: parseKeywords('cardone'), categoryId: 'income' });

  it('REFUSES to file an outflow as income, and sends it to review instead', () => {
    // Reproduced before the fix: `CARDONE MGMT FEE -$125` filed as income with
    // confidence 9900 and needsReview false — and an Income-group row is dropped by
    // isSpendRow, so the spending vanished from reports while the flows engine still
    // counted it. Two surfaces, one row, disagreeing by the amount.
    const out = categorize(
      { ...TXN, amountCents: -12500, rawDescriptor: 'CARDONE MGMT FEE' },
      [INCOME_RULE()],
    );
    expect(out.categoryId).not.toBe('income');
    expect(out.source).not.toBe('user-rule');
    expect(out.needsReview).toBe(true);
  });

  it('still files the INFLOW the reader wrote the rule for', () => {
    const out = categorize(
      { ...TXN, amountCents: 37500, rawDescriptor: 'Cardone Eq Fund Cef Xv Ppd Tran 9912' },
      [INCOME_RULE()],
    );
    expect(out.categoryId).toBe('income');
    expect(out.matchedRuleId).toBe('kw-income');
  });

  it('leaves the refund convention alone — a positive row in a SPEND category is fine', () => {
    // The mirror error would be guarding this direction: a return offsetting a
    // purchase files back to the original category by design (pipeline.ts).
    const out = categorize({ ...TXN, amountCents: 4000, rawDescriptor: 'TJMAXX 0499 RETURN' }, [
      rule({ id: 'kw-shop', matchKeywords: parseKeywords('tjmaxx'), categoryId: 'shopping' }),
    ]);
    expect(out.categoryId).toBe('shopping');
    expect(out.matchedRuleId).toBe('kw-shop');
  });

  it('does not weaken an explicit MERCHANT rule, whose key is an exact identity', () => {
    const out = categorize({ ...TXN, amountCents: -5000, rawDescriptor: 'MACYS LENOX SQUARE' }, [
      rule({ id: 'm-1', merchantCanonical: "Macy's", categoryId: 'income', priority: 100 }),
    ]);
    expect(out.matchedRuleId).toBe('m-1');
  });
});

describe('the minimum key length (critic P2-10)', () => {
  it('a one-letter key would match most rows, so the floor is structural', () => {
    expect(MIN_KEYWORD_LENGTH).toBeGreaterThanOrEqual(3);
    expect(longestKeywordLength(parseKeywords('a'))).toBeLessThan(MIN_KEYWORD_LENGTH);
    expect(longestKeywordLength(parseKeywords('a cardone'))).toBeGreaterThanOrEqual(MIN_KEYWORD_LENGTH);
  });
});

/**
 * OR-GROUPS (TASKS O.13c — Simplifi parity: "Add 'OR' conditions to target
 * different keyword combinations"). The owner's Cardone rows arrive as
 * 'Cardone Eq Fund …' and 'Cardone Equity F …' — one broad keyword spans them,
 * but a reader who wants the narrower keys needs OR: `cardone eq | cardone
 * equity`. The failure directions stay the O.13a ones: an all-empty key still
 * matches NOTHING, and a pre-O.13c stored key must decode byte-identically.
 */
describe('parseKeywordGroups / the group codec', () => {
  it('splits groups on |, keeps AND semantics inside each group', () => {
    expect(parseKeywordGroups('cardone eq | cardone equity')).toEqual([
      ['cardone', 'eq'],
      ['cardone', 'equity'],
    ]);
  });

  it('an input with no | is exactly one group — every pre-O.13c key decodes as before', () => {
    expect(parseKeywordGroups('tjmaxx 0181')).toEqual([['tjmaxx', '0181']]);
    expect(decodeKeywordGroups('tjmaxx 0181')).toEqual([parseKeywords('tjmaxx 0181')]);
  });

  it('drops empty groups, collapses duplicate groups, and refuses the all-empty key', () => {
    expect(parseKeywordGroups('cardone | ')).toEqual([['cardone']]);
    expect(parseKeywordGroups('cardone | cardone')).toEqual([['cardone']]);
    // Duplicates collapse regardless of ORDER — matching is order-free, so these
    // are one condition and storing both rendered two identical chip rows and
    // inflated the audited group count (critic P2-3).
    expect(parseKeywordGroups('cardone eq | eq cardone')).toEqual([['cardone', 'eq']]);
    expect(parseKeywordGroups(' | , | ')).toEqual([]);
    expect(decodeKeywordGroups(null)).toEqual([]);
    expect(decodeKeywordGroups('')).toEqual([]);
  });

  it('round-trips losslessly: no token can contain the group divider', () => {
    // `|` is in the parser's separator set, so `a|b` can never be one token —
    // which is the whole argument that the `|`-join encoding is lossless.
    expect(parseKeywords('a|b')).toEqual(['a', 'b'] as string[]);
    const groups = parseKeywordGroups('cardone eq | cardone equity');
    expect(decodeKeywordGroups(encodeKeywordGroups(groups))).toEqual(groups);
    expect(encodeKeywordGroups([])).toBe('');
  });
});

describe('keywordGroupsMatch — OR of ANDs', () => {
  const EQ = 'Cardone Eq Fund Cef Xv Ppd ~ Tran: 9912';
  const EQUITY = 'Cardone Equity F Cef Ix Ppd ~ Tran: 4471';

  it('matches when ANY one group fully matches', () => {
    const groups = parseKeywordGroups('cardone eq fund | cardone equity');
    expect(keywordGroupsMatch(groups, EQ)).toBe(true);
    expect(keywordGroupsMatch(groups, EQUITY)).toBe(true);
    expect(keywordGroupsMatch(groups, 'PUBLIX #1234')).toBe(false);
  });

  it('refuses the empty groups list — never a match-everything key', () => {
    expect(keywordGroupsMatch([], EQ)).toBe(false);
  });
});

describe('toRuleLikes — one stored rule, one RuleLike per OR-group', () => {
  const base = {
    id: 'r1',
    merchantId: null,
    minAmountCents: null,
    maxAmountCents: null,
    weekendOnly: null,
    weekdayOnly: null,
    accountId: null,
    categoryId: 'investment-income',
    priority: KEYWORD_RULE_PRIORITY,
  };

  it('expands a multi-group key to entries sharing the id, actions, and conditions', () => {
    const out = toRuleLikes(
      {
        ...base,
        matchKeywords: 'cardone eq',
        matchKeywordGroups: 'cardone eq | cardone equity',
        renameTo: 'Cardone',
      },
      new Map(),
    );
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.matchKeywords)).toEqual([
      ['cardone', 'eq'],
      ['cardone', 'equity'],
    ]);
    for (const r of out) {
      expect(r.id).toBe('r1');
      expect(r.renameTo).toBe('Cardone');
      expect(r.categoryId).toBe('investment-income');
    }
  });

  it('the pipeline files EITHER variant through the one stored rule', () => {
    const rules = toRuleLikes(
      {
        ...base,
        matchKeywords: 'cardone eq fund',
        matchKeywordGroups: 'cardone eq fund | cardone equity',
      },
      new Map(),
    );
    for (const rawDescriptor of [
      'Cardone Eq Fund Cef Xv Ppd ~ Tran: 9912',
      'Cardone Equity F Cef Ix Ppd ~ Tran: 4471',
    ]) {
      const out = categorize({ ...TXN, amountCents: 37500, rawDescriptor }, rules);
      expect(out.categoryId).toBe('investment-income');
      expect(out.matchedRuleId).toBe('r1');
    }
  });

  it('still refuses a declared-but-empty key, and passes a pre-O.13c row through unchanged', () => {
    expect(toRuleLikes({ ...base, matchKeywords: '  ,  ', matchKeywordGroups: ' | ' }, new Map())).toEqual(
      [],
    );
    const out = toRuleLikes({ ...base, priority: 100, matchKeywords: null }, new Map());
    expect(out).toHaveLength(1);
    expect(out[0].matchKeywords).toBeNull();
    // And the single-rule mapper agrees with the expansion (shared body).
    expect(toRuleLike({ ...base, matchKeywords: 'tjmaxx' }, new Map())?.matchKeywords).toEqual(['tjmaxx']);
  });

  /**
   * CRITIC CYCLE 1, P0 + P1 — both critics found this independently.
   *
   * O.13c's first cut encoded OR-groups into the EXISTING `matchKeywords` column
   * and taught the parser to treat `|` as the divider. But `|` was an ordinary
   * character inside a keyword under the parser that WROTE every stored row, so
   * that change silently redefined data already in the database: an AND key that
   * required the literal `us|y47` became an OR that fires on `y47` alone, and
   * `shell|a` — which passed the O.13a length floor as one 7-character token —
   * became a group `["a"]` that matches nearly every descriptor and auto-files it
   * at 9900 bps with no review and no badge. Widening is the ONE direction this
   * engine's header forbids in capitals.
   *
   * The groups therefore live in their own column, and these are the fail-old
   * locks for both halves.
   */
  describe('a pre-O.13c stored key keeps its ORIGINAL meaning (critic P0/P1)', () => {
    it('reads a legacy `|` as part of a keyword, never as an OR divider', () => {
      const out = toRuleLikes({ ...base, matchKeywords: 'amzn mktp us|y47' }, new Map());
      // ONE AND-group, and the `|` token survives inside it exactly as stored.
      expect(out).toHaveLength(1);
      expect(out[0].matchKeywords).toEqual(['amzn', 'mktp', 'us|y47']);
      // So it still matches only the literal text it always required…
      expect(
        categorize({ ...TXN, amountCents: 37500, rawDescriptor: 'AMZN MKTP US|Y47 BILL' }, out)
          .matchedRuleId,
      ).toBe('r1');
      // …and NOT the widened OR it would have become.
      expect(
        categorize({ ...TXN, amountCents: 37500, rawDescriptor: 'Y47 SOMETHING ELSE' }, out).matchedRuleId,
      ).toBeNull();
    });

    it('never lets a legacy row widen into a sub-floor file-everything group', () => {
      const out = toRuleLikes({ ...base, matchKeywords: 'shell|a' }, new Map());
      expect(out).toHaveLength(1);
      expect(out[0].matchKeywords).toEqual(['shell|a']);
      // The catastrophic case: an unrelated row must NOT be filed by this rule.
      expect(
        categorize({ ...TXN, amountCents: -4400, rawDescriptor: 'PUBLIX #1234' }, out).matchedRuleId,
      ).toBeNull();
    });

    it('re-applies the per-group length floor on the READ path, dropping only the weak group', () => {
      // Defense in depth, the same discipline `isAggregateCanonical` already gets
      // in this mapper: a guard that runs only at creation is advisory.
      const out = toRuleLikes(
        { ...base, matchKeywords: 'cardone', matchKeywordGroups: 'cardone | eq' },
        new Map(),
      );
      expect(out).toHaveLength(1);
      expect(out[0].matchKeywords).toEqual(['cardone']);
      // Every group too weak ⇒ the rule matches NOTHING, never everything.
      expect(
        toRuleLikes({ ...base, matchKeywords: 'eq', matchKeywordGroups: 'eq | xv' }, new Map()),
      ).toEqual([]);
    });

    it('degrades to the first group, never to everything, if the group column is lost', () => {
      const out = toRuleLikes({ ...base, matchKeywords: 'cardone eq', matchKeywordGroups: null }, new Map());
      expect(out).toHaveLength(1);
      expect(out[0].matchKeywords).toEqual(['cardone', 'eq']);
    });
  });
});

/**
 * RENAME PAYEE (O.13c — Simplifi parity: the THEN action in the owner's
 * screenshot, "Rename Payee: Costco"). The pipeline's returned canonical is what
 * every ingest writer upserts the Merchant row from, so the rename is an
 * identity-level grouping. The guarded directions: a rule that does NOT file
 * (sign-refused) must not rename either, and a rule without a rename must leave
 * the canonical byte-identical.
 */
describe('rename payee — the pipeline half', () => {
  const RENAMING = () =>
    rule({
      id: 'kw-costco',
      matchKeywords: parseKeywords('costco whse'),
      categoryId: 'groceries',
      renameTo: 'Costco',
    });

  it('a filing rule renames the canonical, and the payee becomes known', () => {
    const out = categorize({ ...TXN, rawDescriptor: 'costco whse 1084' }, [RENAMING()]);
    expect(out.matchedRuleId).toBe('kw-costco');
    expect(out.merchantCanonical).toBe('Costco');
    expect(out.merchantKnown).toBe(true);
  });

  it('spans descriptor variants — the same-vendor-presented-differently defect', () => {
    for (const rawDescriptor of ['costco whse 1084', 'COSTCO WHSE #0981 ATLANTA']) {
      expect(categorize({ ...TXN, rawDescriptor }, [RENAMING()]).merchantCanonical).toBe('Costco');
    }
  });

  it('a rule with no rename leaves the canonical byte-identical', () => {
    const plain = rule({ id: 'kw-1', matchKeywords: parseKeywords('mirko') });
    const withRule = categorize({ ...TXN, rawDescriptor: 'MIRKO PASTA' }, [plain]);
    const without = categorize({ ...TXN, rawDescriptor: 'MIRKO PASTA' });
    expect(withRule.merchantCanonical).toBe(without.merchantCanonical);
    expect(withRule.merchantKnown).toBe(without.merchantKnown);
  });

  it('a sign-REFUSED rule renames nothing — the row keeps its recognizable name', () => {
    // `cardone -> income` meeting an outflow: the filing is refused (#44), so the
    // rename must be refused with it — the review row should still read as the
    // bank presented it, not as the name a rule that did NOT fire would have used.
    const out = categorize({ ...TXN, amountCents: -12500, rawDescriptor: 'CARDONE MGMT FEE' }, [
      rule({
        id: 'kw-income',
        matchKeywords: parseKeywords('cardone'),
        categoryId: 'income',
        renameTo: 'Cardone',
      }),
    ]);
    expect(out.source).not.toBe('user-rule');
    expect(out.merchantCanonical).not.toBe('Cardone');
  });

  it('a transfer outranks a renaming rule, exactly as it outranks a filing one', () => {
    const out = categorize({ ...TXN, isTransfer: true, rawDescriptor: 'costco whse 1084' }, [RENAMING()]);
    expect(out.source).toBe('transfer');
    expect(out.merchantCanonical).not.toBe('Costco');
  });
});
