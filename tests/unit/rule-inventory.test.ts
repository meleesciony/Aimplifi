/**
 * The rule inventory (TASKS O.13d / O.15 slice 3) — "show me every rule that files
 * my money."
 *
 * The defect these tests lock, measured in the live code before the slice: the
 * engine loaded EVERY stored rule and the page listed only rows with a typed key,
 * so a rule minted by the inbox's "Always" button filed money on a screen that
 * showed a strict subset of what ran, and the delete action was scoped to that same
 * subset so it could not be removed anywhere.
 *
 * The happy path is one assertion. The file is the failure directions, and for an
 * inventory they are OMISSIONS — a rule that runs and is not listed is the exact
 * bug being fixed, so most of what follows asserts presence, not formatting:
 *
 *   - an "Always" rule appears (it did not, and that is the whole slice);
 *   - a rule the engine REFUSES appears too, named as inactive with its reason —
 *     an invisible dead rule cannot be deleted, and deletion is the only cure;
 *   - the listing order is stable and strongest-first — deliberately NOT a claim about
 *     which rule wins a given transaction, since the pipeline's sign guards can skip
 *     the top-sorted rule entirely;
 *   - the discriminator is the DECLARED key, never the decoded words, so a typed
 *     rule whose key rotted is never renamed an "Always" rule.
 */
import { describe, expect, it } from 'vitest';

import {
  buildRuleInventory,
  isBuilderListed,
  isInventoryListed,
} from '@/lib/engine/categorize/rule-inventory';
import { KEYWORD_RULE_PRIORITY } from '@/lib/engine/categorize/keyword-rule';
import type { RuleRow } from '@/lib/engine/categorize/rule-mapping';

const MERCHANTS = new Map([
  ['m-costco', 'Costco'],
  ['m-venmo', 'Venmo'],
]);

function row(over: Partial<RuleRow> & { id: string }): RuleRow {
  return {
    merchantId: null,
    minAmountCents: null,
    maxAmountCents: null,
    weekendOnly: null,
    weekdayOnly: null,
    accountId: null,
    categoryId: 'groceries',
    priority: 100,
    ...over,
  };
}

describe('buildRuleInventory', () => {
  it('lists the "Always" rule that no screen showed before this slice', () => {
    const inv = buildRuleInventory([row({ id: 'r1', merchantId: 'm-costco' })], MERCHANTS);

    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({
      id: 'r1',
      origin: 'always',
      merchantCanonical: 'Costco',
      categoryId: 'groceries',
      keywordGroups: [],
      active: true,
      refusal: null,
    });
  });

  it('lists a typed rule with every OR-group collapsed back onto its stored row', () => {
    const inv = buildRuleInventory(
      [
        row({
          id: 'r1',
          matchKeywords: 'cardone eq',
          matchKeywordGroups: 'cardone eq|cardone equity',
          categoryId: 'income',
          renameTo: 'Cardone',
          priority: KEYWORD_RULE_PRIORITY,
        }),
      ],
      MERCHANTS,
    );

    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({
      id: 'r1',
      origin: 'typed',
      merchantCanonical: null,
      keywordGroups: [
        ['cardone', 'eq'],
        ['cardone', 'equity'],
      ],
      renameTo: 'Cardone',
      active: true,
    });
  });

  it('carries the conditions verbatim so the page never invents a narrower rule', () => {
    const inv = buildRuleInventory(
      [
        row({
          id: 'r1',
          merchantId: 'm-costco',
          minAmountCents: 1000,
          maxAmountCents: 250_00,
          weekendOnly: true,
          accountId: 'acct-1',
        }),
      ],
      MERCHANTS,
    );

    expect(inv[0].conditions).toEqual({
      minAmountCents: 1000,
      maxAmountCents: 25000,
      weekendOnly: true,
      weekdayOnly: null,
      accountId: 'acct-1',
    });
  });

  describe('rules the engine refuses are LISTED, not hidden', () => {
    it('an orphaned merchant reference is inactive, named, and still deletable', () => {
      const inv = buildRuleInventory([row({ id: 'r1', merchantId: 'm-gone' })], MERCHANTS);

      expect(inv).toHaveLength(1);
      expect(inv[0]).toMatchObject({ id: 'r1', active: false, refusal: 'orphan-merchant' });
      // Never a MATCHING identity — and an orphan has no name left to show either.
      expect(inv[0].merchantCanonical).toBeNull();
      expect(inv[0].refusedCanonical).toBeNull();
    });

    /**
     * Critic P1-3: suppressing the name here made the row announce a missing payee
     * directly above a sentence explaining it was Venmo — two contradictory claims
     * about one rule, and no way to tell which rule to delete.
     */
    it('an aggregate payee is inactive, and STILL NAMES the payee so the reader can find it', () => {
      const inv = buildRuleInventory([row({ id: 'r1', merchantId: 'm-venmo' })], MERCHANTS);

      expect(inv[0]).toMatchObject({ active: false, refusal: 'aggregate-merchant' });
      // Not a matching identity…
      expect(inv[0].merchantCanonical).toBeNull();
      // …but the reader is told which rule this is.
      expect(inv[0].refusedCanonical).toBe('Venmo');
    });

    it('a declared key that decodes to nothing is inactive — the file-everything trap', () => {
      const inv = buildRuleInventory([row({ id: 'r1', matchKeywords: '' })], MERCHANTS);

      expect(inv[0]).toMatchObject({ active: false, refusal: 'empty-keyword-key' });
      expect(inv[0].keywordGroups).toEqual([]);
    });

    it('still calls a rotted typed key TYPED — the gesture that made it did not change', () => {
      const inv = buildRuleInventory([row({ id: 'r1', matchKeywords: '' })], MERCHANTS);

      expect(inv[0].origin).toBe('typed');
    });
  });

  /**
   * Critic P2-5: a row with no payee AND no typed words matches EVERY transaction
   * (`ruleMatches` skips both key checks), and the first version described it as "a
   * payee that is no longer here" — the broadest rule in the account rendered as the
   * most harmless one. The engine's behaviour is deliberately unchanged; what changed
   * is that the page can now say what the row does.
   */
  it('flags a rule with no payee and no words as matching EVERYTHING', () => {
    const inv = buildRuleInventory([row({ id: 'r1' })], MERCHANTS);

    expect(inv[0]).toMatchObject({ active: true, refusal: null, matchesEverything: true });
  });

  it('does not flag a normal rule as matching everything', () => {
    const inv = buildRuleInventory(
      [
        row({ id: 'r-merchant', merchantId: 'm-costco' }),
        row({ id: 'r-typed', matchKeywords: 'costco' }),
      ],
      MERCHANTS,
    );

    expect(inv.every((e) => e.matchesEverything)).toBe(false);
  });

  describe('order', () => {
    it('lists the strongest-looking rule first (priority, then specificity)', () => {
      const inv = buildRuleInventory(
        [
          row({ id: 'r-merchant', merchantId: 'm-costco', priority: 100 }),
          row({ id: 'r-broad', matchKeywords: 'costco', priority: KEYWORD_RULE_PRIORITY }),
          row({ id: 'r-narrow', matchKeywords: 'costco gas', priority: KEYWORD_RULE_PRIORITY }),
        ],
        MERCHANTS,
      );

      expect(inv.map((e) => e.id)).toEqual(['r-narrow', 'r-broad', 'r-merchant']);
    });

    /**
     * Critic P3-6: `pipeline.ts` applies its id tie-break ONLY between typed keyword
     * rules — merchant-keyed rules keep insertion order there, because
     * `ensureUnconditionalRule`'s supersede logic is written against it. A list that
     * re-sorted them by id would assert an order the engine does not use.
     */
    it('leaves equal-priority merchant rules in the order they were created', () => {
      const inv = buildRuleInventory(
        [
          row({ id: 'r-z', merchantId: 'm-costco', priority: 100 }),
          row({ id: 'r-a', merchantId: 'm-costco', priority: 100 }),
        ],
        MERCHANTS,
      );

      expect(inv.map((e) => e.id)).toEqual(['r-z', 'r-a']);
    });

    it('breaks an exact tie between TYPED rules by id, so the list never reorders between reads', () => {
      const inv = buildRuleInventory(
        [
          row({ id: 'r-b', matchKeywords: 'costco', priority: KEYWORD_RULE_PRIORITY }),
          row({ id: 'r-a', matchKeywords: 'target', priority: KEYWORD_RULE_PRIORITY }),
        ],
        MERCHANTS,
      );

      expect(inv.map((e) => e.id)).toEqual(['r-a', 'r-b']);
    });

    it('sorts every inactive rule last — an order claim about a rule that never runs is a sentence about nothing', () => {
      const inv = buildRuleInventory(
        [
          row({ id: 'r-dead', matchKeywords: '', priority: 999 }),
          row({ id: 'r-live', merchantId: 'm-costco', priority: 100 }),
        ],
        MERCHANTS,
      );

      expect(inv.map((e) => e.id)).toEqual(['r-live', 'r-dead']);
    });

    it('ranks a multi-group rule by its most specific group', () => {
      const inv = buildRuleInventory(
        [
          row({
            id: 'r-multi',
            matchKeywords: 'costco',
            matchKeywordGroups: 'costco|costco gas station',
            priority: KEYWORD_RULE_PRIORITY,
          }),
          row({ id: 'r-two', matchKeywords: 'costco gas', priority: KEYWORD_RULE_PRIORITY }),
        ],
        MERCHANTS,
      );

      expect(inv.map((e) => e.id)).toEqual(['r-multi', 'r-two']);
    });
  });

  /**
   * The page renders two lists. Rendering a rule twice and rendering it zero times are
   * the same bug with different symptoms, so the partition is asserted over every row
   * state this file can construct — including the one no writer produces today (a row
   * carrying BOTH a merchantId and a typed key), which the first version put in both
   * lists at once (critic P3-7).
   */
  describe('the two lists partition the inventory: never twice, never neither', () => {
    /**
     * The EXPECTED side is written out per shape, not derived. The first version of
     * this test asserted `isBuilderListed(e) === isInventoryListed(e)` is false, which
     * is `x === !x` — true of every possible implementation, including the one the
     * P3-7 fix was written to avoid (cycle-2 F4). A partition test that cannot fail
     * is a comment with a green tick next to it.
     *
     * What this DOES lock is membership per shape. What it deliberately does not
     * claim is that it separates the two formulations of `isBuilderListed` — they are
     * equivalent over every entry the mapper can build, and the module says so.
     */
    const EVERY_SHAPE: [string, RuleRow, 'builder' | 'inventory'][] = [
      ['a-merchant', row({ id: 'a-merchant', merchantId: 'm-costco' }), 'inventory'],
      ['b-typed', row({ id: 'b-typed', matchKeywords: 'costco' }), 'builder'],
      ['c-orphan', row({ id: 'c-orphan', merchantId: 'm-gone' }), 'inventory'],
      ['d-aggregate', row({ id: 'd-aggregate', merchantId: 'm-venmo' }), 'inventory'],
      // A typed rule whose key decoded to nothing: the builder's list drops it, so
      // only the inventory can show it — and only the inventory's delete can remove it.
      ['e-rotted-key', row({ id: 'e-rotted-key', matchKeywords: '' }), 'inventory'],
      ['f-everything', row({ id: 'f-everything' }), 'inventory'],
      // No writer sets both keys today; if one ever does, the row still lands in
      // exactly one list rather than being rendered twice.
      ['g-both-keys', row({ id: 'g-both-keys', merchantId: 'm-costco', matchKeywords: 'costco' }), 'builder'],
      [
        'h-both-keys-orphaned',
        row({ id: 'h-both-keys-orphaned', merchantId: 'm-gone', matchKeywords: 'costco' }),
        'inventory',
      ],
    ];

    it.each(EVERY_SHAPE)('%s belongs to the %s list and no other', (_id, r, expected) => {
      const [entry] = buildRuleInventory([r], MERCHANTS);

      expect(isBuilderListed(entry)).toBe(expected === 'builder');
      expect(isInventoryListed(entry)).toBe(expected === 'inventory');
    });

    it('covers the whole set with no row left out and none rendered twice', () => {
      const inv = buildRuleInventory(
        EVERY_SHAPE.map(([, r]) => r),
        MERCHANTS,
      );
      const builder = inv.filter(isBuilderListed).map((e) => e.id);
      const inventory = inv.filter(isInventoryListed).map((e) => e.id);

      expect(builder.sort()).toEqual(['b-typed', 'g-both-keys']);
      expect([...builder, ...inventory].sort()).toEqual(EVERY_SHAPE.map(([id]) => id).sort());
    });
  });

  it('returns an empty inventory for a reader with no rules', () => {
    expect(buildRuleInventory([], MERCHANTS)).toEqual([]);
  });
});
