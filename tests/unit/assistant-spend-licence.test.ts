/**
 * TASKS 2.6 — `spend_total` must EARN its answer (the spend-family sink, #226).
 *
 * Four hostile-critic cycles each hardened one verb-anchored guard in front of
 * the sink, and each time the input moved one syntactic inch (fronted object,
 * sentence break, punctuation glue) and landed on the ALL-spending total anyway
 * — a true figure under a false question, the repo's cardinal sin. This file
 * locks the INVERSION: a positive licence (no unconsumed at/with/on object
 * anywhere) is now required before the parser, the conversation frame, or
 * `intentFromKind` may return `spend_total` — plus the bundled siblings:
 * "at home depot" → the Home GROUP (rent+mortgage for one retailer),
 * punctuation-mangled merchants, and the unreachable non-ASCII custom category.
 * TODAY = 2026-06-23 → this month 2026-06, last month 2026-05.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import {
  customCategoryForObject,
  parseAssistantQuery,
  resolveSpendTarget,
  unconsumedSpendObject,
} from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';

const TODAY = isoDate('2026-06-23');
const CAFE = { id: 'cust_cafe', name: 'Café' };

describe('test_regression__fronted_ascii_object_reaches_spend_total (TASKS 2.6 item 1)', () => {
  it('a fronted merchant object withholds the licence — never the all-spending total', () => {
    // Pre-2.6 every one of these answered the user's ENTIRE spending, unhedged,
    // for a question about ONE store: the merchant extractor only recognizes
    // verb-then-preposition order, and the sink asked no questions.
    for (const q of [
      'at costco, how much did i spend?',
      'At Costco, how much did I spend last month?',
      'i spent so much. at costco how much?',
      'at trader joes, what did i spend this month?',
    ]) {
      expect(parseAssistantQuery(q, TODAY).kind, q).toBe('unknown');
    }
  });

  it('a fronted NON-merchant object withholds it just as the verb-anchored guard did', () => {
    // "on average" abstains verb-anchored (#166); the fronted form must not differ.
    expect(parseAssistantQuery('on average, how much did i spend?', TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery('with my amex, how much did i spend?', TODAY).kind).toBe('unknown');
  });

  it('licensed objects and object-less questions keep the total (no false abstain)', () => {
    for (const q of [
      'how much did i spend last month',
      'how much did i spend on everything last month',
      'what did i spend in total on everything',
      'how much did i spend on march 5',
      'did i spend at all last month',
      // fronted IDIOM: "at the end / at least / on track" is not a store
      'at the end of last month, how much did i spend?',
      "what's going on with my spending this month",
    ]) {
      expect(parseAssistantQuery(q, TODAY).kind, q).toBe('spend_total');
    }
  });

  it('unconsumedSpendObject — the licence primitive', () => {
    expect(unconsumedSpendObject('at costco, how much did i spend')).toBe('costco');
    expect(unconsumedSpendObject('how much did i spend on everything')).toBeNull();
    expect(unconsumedSpendObject('at the end of last month, how much did i spend')).toBeNull();
    // "on march 5" is a DATE (day digit right after a month); a bare number is
    // not ("at 76" is a gas station, "on 3/5" is a window no engine parses —
    // the pre-slice parser abstained on it too, via the verb-anchored guard).
    expect(unconsumedSpendObject('how much did i spend on march 5')).toBeNull();
    expect(unconsumedSpendObject('how much did i spend on 3/5')).toBe('3/5');
    expect(unconsumedSpendObject('on average, how much per month')).toBe('average');
    expect(unconsumedSpendObject('how much did i spend')).toBeNull();
  });

  it('test_regression__one_licensed_word_is_not_a_licence (critic cycle 1, F1/F2 — P0)', () => {
    // Real retailers whose FIRST word the licence recognizes: "best" (idiom),
    // "top"/"all" (total/idiom), "5"/"76" (numeric), "last" (timeframe cue).
    // The cycle-1 scan let that first token consume the WHOLE object, granting
    // the all-spending total to a one-store question through every route at
    // once (parser, vocab, LLM — the primitive is shared). Every word of the
    // object must now be consumed-class before the total is licensed.
    for (const q of [
      'at best buy, how much did i spend?',
      'at top golf, how much did i spend last month?',
      'at all saints, how much did i spend?',
      'at 5 guys, how much did i spend?',
      'at 76, how much did i spend last month?',
      'i was at best buy. how much did i spend?',
    ]) {
      expect(parseAssistantQuery(q, TODAY).kind, q).toBe('unknown');
      expect(intentFromKind('spend_total', q, TODAY), q).toBeNull();
    }
    // …while the licensed idioms those words came from keep their totals.
    expect(parseAssistantQuery('at the end of last month, how much did i spend?', TODAY).kind).toBe('spend_total');
    expect(parseAssistantQuery('at the very least how much did i spend', TODAY).kind).toBe('spend_total');
    expect(unconsumedSpendObject('at best buy, how much did i spend?')).toBe('buy');
  });

  it('test_regression__in_and_atsign_join_the_licence (critic cycle 1, F5)', () => {
    // "in <store>" and "@ <store>" are everyday merchant phrasings the licence
    // did not scan — both took the total.
    expect(parseAssistantQuery('how much did i spend in costco?', TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery('how much did i spend @ costco', TODAY).kind).toBe('unknown');
    // …while "in <window>" phrasings keep their totals.
    expect(parseAssistantQuery('how much did i spend in june', TODAY).kind).toBe('spend_total');
    expect(parseAssistantQuery('how much did i spend in may 2026', TODAY).kind).toBe('spend_total');
    expect(parseAssistantQuery('what did i spend in total on everything', TODAY).kind).toBe('spend_total');
  });

  it('intentFromKind enforces the same licence — the LLM cannot re-answer what the parser abstained on', () => {
    // The model's closed set has no merchant_spend, so its only expressible
    // reading of a one-store question IS the total. A kind is a hint, never a
    // licence to answer a different question.
    expect(intentFromKind('spend_total', 'at costco, how much did i spend?', TODAY)).toBeNull();
    expect(intentFromKind('spend_total', 'how much did i spend last month', TODAY)).toMatchObject({
      kind: 'spend_total',
    });
    // the learned-vocab canonical ("burn rate") keeps routing
    expect(intentFromKind('spend_total', 'what is my burn rate', TODAY)).toMatchObject({
      kind: 'spend_total',
    });
  });
});

describe('test_regression__home_depot_is_not_the_home_group (TASKS 2.6 item 2)', () => {
  it('"at home depot" is a STORE, not rent+mortgage', () => {
    // #111-era substring fallback: `q.includes('home')` matched inside "home
    // depot" (and inside the WORD "homegoods") and answered the Home GROUP —
    // rent + mortgage inside a figure for a question about one retailer.
    expect(parseAssistantQuery('how much did i spend at home depot', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'home depot',
    });
    expect(parseAssistantQuery('how much did i spend at homegoods last month', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'homegoods',
    });
  });

  it('a verbatim group mention still resolves (word-bounded, not extended)', () => {
    expect(parseAssistantQuery('how much did i spend on home last month', TODAY)).toMatchObject({
      kind: 'spend_by_category',
      target: { type: 'group', group: 'Home' },
    });
    expect(resolveSpendTarget('how much on travel this month')).toMatchObject({ type: 'group', group: 'Travel' });
    // NOTE deliberately unfixed here: a tier-1 SYNONYM inside a store name
    // ("at travel lodge" → Travel, "at shell gas station" → fuel) is the same
    // disease via the curated table — recorded in STATUS, not patched at the
    // tail of this slice (the 4-cycle lesson: no ad-hoc fifth guard).
  });
});

describe('test_regression__punctuation_after_the_preposition (TASKS 2.6 item 3)', () => {
  it('"at - costco" / "at... costco" resolve the merchant, not filler or the total', () => {
    // "at - costco" made the dash part of the store name (a confident-wrong
    // "No spending at - costco"); "at... costco" matched no guard at all and
    // fell through to the all-spending total.
    expect(parseAssistantQuery('how much did i spend at - costco', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'costco',
    });
    expect(parseAssistantQuery('how much did i spend at... costco', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'costco',
    });
    expect(parseAssistantQuery('how much did i spend at, costco last month', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'costco',
    });
  });
});

describe('test_regression__non_ascii_custom_category_unreachable (TASKS 2.6 item 4)', () => {
  it('the user\'s own "Café" category resolves — their vocabulary is readable by definition', () => {
    const composed = parseAssistantQuery('how much did i spend on café this month', TODAY, [CAFE]);
    expect(composed).toMatchObject({
      kind: 'spend_by_category',
      target: { type: 'category', categoryId: 'cust_cafe', label: 'Café' },
    });
    // decomposed bytes (NFD) route identically — the user cannot tell them apart
    const nfd = parseAssistantQuery('how much did i spend on café this month'.normalize('NFD'), TODAY, [CAFE]);
    expect(nfd.kind).toBe('spend_by_category');
    // a stated window survives the carve-out
    expect(parseAssistantQuery('how much did i spend on café last month', TODAY, [CAFE])).toMatchObject({
      kind: 'spend_by_category',
      timeframe: { fromYm: '2026-05', toYm: '2026-05' },
    });
  });

  it('equality, not containment: a STORE whose name contains the category still abstains', () => {
    expect(parseAssistantQuery('how much did i spend at café zurich', TODAY, [CAFE]).kind).toBe('unknown');
  });

  it('without the custom list the same question abstains (nothing to read it against)', () => {
    expect(parseAssistantQuery('how much did i spend on café this month', TODAY).kind).toBe('unknown');
  });

  it('customCategoryForObject — the carve-out primitive', () => {
    expect(customCategoryForObject('café', [CAFE])).toMatchObject({ categoryId: 'cust_cafe' });
    expect(customCategoryForObject('my café last month', [CAFE])).toMatchObject({ categoryId: 'cust_cafe' });
    expect(customCategoryForObject('café zurich', [CAFE])).toBeNull();
    expect(customCategoryForObject('café', [])).toBeNull();
  });

  it('test_regression__carve_out_prefix_is_not_equality (critic cycle 2, NEW-2)', () => {
    // The carve-out truncated the object at a stop word and tested equality on
    // the PREFIX — so "at café in 星巴克 town" matched "café" and the unreadable
    // store rode through silently dropped, in both parser and frame. The tail
    // after the cue must itself be pure timeframe/total cues.
    expect(parseAssistantQuery('how much did i spend at café in 星巴克 town', TODAY, [CAFE]).kind).toBe('unknown');
    expect(parseAssistantQuery('how much did i spend at café for groceries', TODAY, [CAFE]).kind).toBe('unknown');
    expect(customCategoryForObject('café in 星巴克 town', [CAFE])).toBeNull();
    expect(customCategoryForObject('café in 🍕', [CAFE])).toBeNull();
    // …while a pure-cue tail keeps the category (the carve-out's whole point).
    expect(customCategoryForObject('café in june', [CAFE])).toMatchObject({ categoryId: 'cust_cafe' });
    expect(parseAssistantQuery('how much did i spend on café last month', TODAY, [CAFE]).kind).toBe('spend_by_category');
  });

  it('test_regression__store_made_entirely_of_question_words (critic cycle 2, NEW-1)', () => {
    // "Do It Best" — a real ~1,400-store hardware chain — is spelled entirely
    // in tokens the licence recognizes ('do' auxiliary, 'it' total, 'best'
    // idiom), so it licensed the all-spending total in fronted word order. An
    // auxiliary is question machinery only ahead of another question word
    // ("did I"), never ahead of a store's word ("do it…").
    expect(parseAssistantQuery('at do it best, how much did i spend?', TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery('at do it best, how much did i spend last month?', TODAY).kind).toBe('unknown');
    expect(intentFromKind('spend_total', 'at do it best, how much did i spend?', TODAY)).toBeNull();
    expect(unconsumedSpendObject('at do it best, how much did i spend?')).toBe('do');
    // …while the auxiliaries keep licensing genuine question tails.
    expect(parseAssistantQuery('at the very least how much did i spend', TODAY).kind).toBe('spend_total');
    expect(parseAssistantQuery('at the end of last month, how much did i spend?', TODAY).kind).toBe('spend_total');
  });
});
