/**
 * The rule THEN-action "tag this for taxes" (O.15 slice 6) — pure semantics.
 *
 * The abstentions are the majority of this file on purpose. A tag is a claim about
 * a DEDUCTION, so the expensive failure is not "a row went untagged" (visible in
 * the export as a smaller number the reader can question) but "a row the reader
 * answered was re-answered by a rule" — invisible, and wrong in exactly the way a
 * figure handed to a preparer must never be. Every case below that returns null is
 * one of those.
 */
import { describe, expect, it } from 'vitest';
import {
  hasTag,
  normalizeSetTaxClass,
  resolveRuleTaxStamp,
} from '@/lib/engine/categorize/tax-action';
import { categorize, type RuleLike } from '@/lib/engine/categorize/pipeline';

const KEYWORD_RULE: RuleLike = {
  id: 'r1',
  merchantCanonical: null,
  matchKeywords: ['adobe'],
  setTaxClass: 'business',
  minAmountCents: null,
  maxAmountCents: null,
  weekendOnly: null,
  weekdayOnly: null,
  accountId: null,
  categoryId: 'software',
  priority: 110,
};

const TXN = {
  rawDescriptor: 'ADOBE *XXX-XXX-6687',
  amountCents: -5999,
  date: '2026-07-23',
  accountId: 'a1',
};

describe('resolveRuleTaxStamp', () => {
  it('stamps an untagged row with the class the rule carries', () => {
    expect(resolveRuleTaxStamp({ ruleTaxClass: 'business', currentTaxClass: null })).toBe('business');
    expect(resolveRuleTaxStamp({ ruleTaxClass: 'medical', currentTaxClass: undefined })).toBe('medical');
  });

  it('NEVER overwrites a tag the row already carries', () => {
    expect(resolveRuleTaxStamp({ ruleTaxClass: 'business', currentTaxClass: 'medical' })).toBeNull();
  });

  it('leaves a row alone even when it already carries the SAME class — a no-op is not a write', () => {
    // The counts this feeds are shown as "tagged N transactions". Reporting a
    // write that changes nothing would make the preview promise more than the
    // apply performs.
    expect(resolveRuleTaxStamp({ ruleTaxClass: 'business', currentTaxClass: 'business' })).toBeNull();
  });

  it('will not overwrite an UNRECOGNIZED stored tag either', () => {
    // `isTaxClass` reads this row as untagged everywhere else, but overwriting
    // would destroy the only record of what the reader chose. Under-tagging is the
    // visible direction; destroying an answer is not.
    expect(resolveRuleTaxStamp({ ruleTaxClass: 'business', currentTaxClass: 'crypto-losses' })).toBeNull();
  });

  it('tags nothing when the RULE carries no class, a blank, or an unknown one', () => {
    expect(resolveRuleTaxStamp({ ruleTaxClass: null, currentTaxClass: null })).toBeNull();
    expect(resolveRuleTaxStamp({ ruleTaxClass: undefined, currentTaxClass: null })).toBeNull();
    expect(resolveRuleTaxStamp({ ruleTaxClass: '', currentTaxClass: null })).toBeNull();
    expect(resolveRuleTaxStamp({ ruleTaxClass: 'BUSINESS', currentTaxClass: null })).toBeNull();
    expect(resolveRuleTaxStamp({ ruleTaxClass: 'not-a-class', currentTaxClass: null })).toBeNull();
  });

  it('treats a blank stored value as untagged (an empty drawer is not a claim)', () => {
    expect(hasTag('')).toBe(false);
    expect(hasTag('   ')).toBe(false);
    expect(hasTag(null)).toBe(false);
    expect(hasTag('medical')).toBe(true);
    expect(resolveRuleTaxStamp({ ruleTaxClass: 'business', currentTaxClass: '  ' })).toBe('business');
  });
});

describe('normalizeSetTaxClass', () => {
  it('keeps a member of the closed set and refuses everything else', () => {
    expect(normalizeSetTaxClass('business')).toBe('business');
    expect(normalizeSetTaxClass('  charitable ')).toBe('charitable');
    expect(normalizeSetTaxClass('')).toBeNull();
    expect(normalizeSetTaxClass(null)).toBeNull();
    expect(normalizeSetTaxClass('Business')).toBeNull();
    expect(normalizeSetTaxClass('anything')).toBeNull();
  });
});

describe('categorize() — which filings may carry a tag', () => {
  it('a typed keyword rule that FILES the row tags it', () => {
    const out = categorize(TXN, [KEYWORD_RULE]);
    expect(out.categoryId).toBe('software');
    expect(out.taxClassStamp).toBe('business');
  });

  it('the same rule tags nothing when the row is already tagged', () => {
    const out = categorize({ ...TXN, currentTaxClass: 'medical' }, [KEYWORD_RULE]);
    expect(out.categoryId).toBe('software');
    expect(out.taxClassStamp).toBeNull();
  });

  it('a LEARNED rule never tags, even carrying the column', () => {
    // A learned rule is the app's own inference from repetition. A tax tag is a
    // claim only an instruction the reader typed may make — the same line the
    // rename action draws.
    const out = categorize(TXN, [{ ...KEYWORD_RULE, isLearned: true }]);
    expect(out.categoryId).toBe('software');
    expect(out.taxClassStamp).toBeNull();
  });

  it('a rule the SIGN GUARD refuses tags nothing — it did not file, so it does not tag', () => {
    // An OUTFLOW into an Income category is refused by `keywordRuleSignOk`, so the
    // row falls through to review. Tagging it here would make the same row carry
    // one answer from a backfill and another from the next sync.
    const out = categorize(TXN, [{ ...KEYWORD_RULE, categoryId: 'income' }]);
    expect(out.source).not.toBe('user-rule');
    expect(out.taxClassStamp).toBeNull();
  });

  it('a merchant default, a transfer and a fallback all tag nothing', () => {
    expect(categorize({ ...TXN, rawDescriptor: 'STARBUCKS 800-782-7282' }, []).taxClassStamp).toBeNull();
    expect(categorize({ ...TXN, isTransfer: true }, [KEYWORD_RULE]).taxClassStamp).toBeNull();
    expect(categorize({ ...TXN, rawDescriptor: 'ZZQQ UNKNOWN 4471' }, []).taxClassStamp).toBeNull();
  });

  it('a rule with NO tag action leaves the field null — every pre-slice rule is unchanged', () => {
    const out = categorize(TXN, [{ ...KEYWORD_RULE, setTaxClass: null }]);
    expect(out.categoryId).toBe('software');
    expect(out.taxClassStamp).toBeNull();
  });
});
