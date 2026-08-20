/**
 * Ask Aimplifi — deterministic intent parser known-answer tests (DECISIONS #75).
 * Every expected intent is hand-written: the parser is pure and rule-based, so
 * these pin its routing decisions. TODAY = 2026-06-23 → this month 2026-06, last
 * month 2026-05, this year 2026-01..2026-06.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import {
  parseAssistantQuery,
  parseTimeframe,
  resolveSpendTarget,
  validateIntent,
  type AssistantIntent,
} from '@/lib/engine/assistant/intent';

const TODAY = isoDate('2026-06-23');
const kindOf = (q: string) => parseAssistantQuery(q, TODAY).kind;

describe('parseAssistantQuery — routing', () => {
  const cases: [string, AssistantIntent['kind']][] = [
    // net worth
    ["What's my net worth?", 'net_worth'],
    ['show me my networth', 'net_worth'],
    // savings rate (beats the generic "savings" account match)
    ["what's my savings rate?", 'savings_rate'],
    ['how much of my income do I save', 'savings_rate'],
    // subscriptions
    ['what subscriptions am I paying for?', 'subscriptions'],
    ['list my recurring payments', 'subscriptions'],
    ['how much do I spend on recurring charges', 'subscriptions'],
    // cash flow radar / run-out (DECISIONS #488) — before thin forecast
    ['will I run out of money in the next 90 days?', 'cash_flow_radar'],
    ['am I going to go negative', 'cash_flow_radar'],
    ['cash flow radar', 'cash_flow_radar'],
    // forecast (recurring-only)
    ["what's my cash flow forecast", 'forecast'],
    ['projected balance in 90 days', 'forecast'],
    // cash needed
    ['how much do I need to pay my cards?', 'cash_needed'],
    ['what do I owe on my credit cards', 'cash_needed'],
    ['when is my credit card payment due', 'cash_needed'],
    ['how much to pay off my cards this cycle', 'cash_needed'],
    // safe to spend (present/conditional, with adverbs)
    ['how much can I safely spend this month?', 'safe_to_spend'],
    ["what's safe to spend right now", 'safe_to_spend'],
    ['can I afford to spend more this week', 'safe_to_spend'],
    ['how much do I have left to spend', 'safe_to_spend'],
    // guilt-free alias (#295) — present-tense plan questions route…
    ['How much is guilt-free to spend this month?', 'safe_to_spend'],
    ['what can I spend guilt-free?', 'safe_to_spend'],
    ["what's my guilt free spending", 'safe_to_spend'],
    // …but the alias is GATED off past-tense spend questions (critic P1-4):
    // "Guilt Free" is a real merchant/product phrase, and a past-month
    // merchant total must never be answered with this month's plan figure.
    ['How much did I spend at Guilt Free Bakery in June?', 'merchant_spend'],
    ['how much did i spend at guilt free desserts last month', 'merchant_spend'],
    // largest purchases
    ['what was my biggest purchase this month?', 'largest_purchases'],
    ['show my most expensive transactions last month', 'largest_purchases'],
    ["what's the largest thing I bought", 'largest_purchases'],
    // income
    ['how much did I make last month?', 'income'],
    ['how much have I earned this year', 'income'],
    ['what was my income in May', 'income'],
    // spend total / by category / top
    ['how much did I spend last month', 'spend_total'],
    ['how much did I spend on groceries last month?', 'spend_by_category'],
    ['how much did I spend on dining out this month', 'spend_by_category'],
    ['how much do I spend on coffee', 'spend_by_category'],
    ['how much did I spend on food in May', 'spend_by_category'],
    ['what did I spend the most on this month', 'top_categories'],
    ['what are my top spending categories', 'top_categories'],
    ['where does my money go', 'top_categories'],
    // merchant spend (#168): a non-category object after at/on/with is a merchant
    ['how much did I spend at costco', 'merchant_spend'],
    ['how much have I spent at trader joes this year', 'merchant_spend'],
    ['what did I spend at target last month', 'merchant_spend'],
    // category synonyms keep precedence — "on coffee"/"on groceries" stay categories
    ['how much did I spend on coffee', 'spend_by_category'],
    ['how much did I spend on groceries', 'spend_by_category'],
    // account balance
    ["what's my checking balance?", 'account_balance'],
    ['how much is in my savings account', 'account_balance'],
    // unknown
    ["what's the weather", 'unknown'],
    ['tell me a joke', 'unknown'],
    ['', 'unknown'],
  ];

  it.each(cases)('routes %j → %s', (q, expected) => {
    expect(kindOf(q)).toBe(expected);
  });
});

describe('parseAssistantQuery — extracted params', () => {
  it('resolves category + timeframe together', () => {
    const i = parseAssistantQuery('how much did I spend on groceries last month?', TODAY);
    expect(i).toEqual({
      kind: 'spend_by_category',
      timeframe: { fromYm: '2026-05', toYm: '2026-05', label: 'last month' },
      target: { type: 'category', categoryId: 'groceries', label: 'Groceries' },
    });
  });

  it('maps "food" to the whole Food & Dining group', () => {
    const i = parseAssistantQuery('how much did I spend on food this month', TODAY);
    expect(i.kind).toBe('spend_by_category');
    if (i.kind === 'spend_by_category') expect(i.target).toEqual({ type: 'group', group: 'Food & Dining', label: 'food & dining' });
  });

  it('resolves a multi-word merchant + timeframe, trimming the timeframe off the term (#168)', () => {
    const i = parseAssistantQuery('how much did I spend at trader joes last month', TODAY);
    expect(i).toEqual({
      kind: 'merchant_spend',
      timeframe: { fromYm: '2026-05', toYm: '2026-05', label: 'last month' },
      merchant: 'trader joes',
    });
  });

  it('captures a single-word merchant with no timeframe as this month (#168)', () => {
    const i = parseAssistantQuery('what did I spend at costco', TODAY);
    expect(i).toEqual({
      kind: 'merchant_spend',
      timeframe: { fromYm: '2026-06', toYm: '2026-06', label: 'this month' },
      merchant: 'costco',
    });
  });
});

describe('parseTimeframe', () => {
  it('this month / last month / this year', () => {
    expect(parseTimeframe('this month', TODAY)).toEqual({ fromYm: '2026-06', toYm: '2026-06', label: 'this month' });
    expect(parseTimeframe('last month', TODAY)).toEqual({ fromYm: '2026-05', toYm: '2026-05', label: 'last month' });
    expect(parseTimeframe('this year', TODAY)).toEqual({ fromYm: '2026-01', toYm: '2026-06', label: '2026 so far' });
  });
  it('named month resolves to the most recent past occurrence', () => {
    expect(parseTimeframe('in May', TODAY)).toEqual({ fromYm: '2026-05', toYm: '2026-05', label: 'May 2026' });
    // August hasn't happened yet in June 2026 → last year's August
    expect(parseTimeframe('in August', TODAY)).toEqual({ fromYm: '2025-08', toYm: '2025-08', label: 'August 2025' });
  });
  it('explicit year wins', () => {
    expect(parseTimeframe('in March 2024', TODAY)).toEqual({ fromYm: '2024-03', toYm: '2024-03', label: 'March 2024' });
  });
  it('trailing N months', () => {
    expect(parseTimeframe('the last 3 months', TODAY)).toEqual({ fromYm: '2026-04', toYm: '2026-06', label: 'the last 3 months' });
  });
  it('defaults to this month', () => {
    expect(parseTimeframe('blah', TODAY)).toEqual({ fromYm: '2026-06', toYm: '2026-06', label: 'this month' });
  });
});

describe('resolveSpendTarget', () => {
  it('leaf categories beat their group', () => {
    expect(resolveSpendTarget('groceries')).toEqual({ type: 'category', categoryId: 'groceries', label: 'Groceries' });
    expect(resolveSpendTarget('gas')).toEqual({ type: 'category', categoryId: 'fuel', label: 'Fuel' });
    expect(resolveSpendTarget('coffee')).toEqual({ type: 'category', categoryId: 'coffee', label: 'Coffee Shops' });
  });
  it('broad words map to groups', () => {
    expect(resolveSpendTarget('travel')).toEqual({ type: 'group', group: 'Travel', label: 'travel' });
  });
  // #154 critic P1: "gas bill"/"natural gas" is the UTILITY, not gasoline — the
  // synonym must beat the bare `gas`→fuel rule instead of being shadowed dead.
  it('gas bill / natural gas resolve to the natural-gas utility, not fuel', () => {
    expect(resolveSpendTarget('natural gas')).toEqual({ type: 'category', categoryId: 'natural-gas', label: 'Natural Gas' });
    expect(resolveSpendTarget('my gas bill')).toEqual({ type: 'category', categoryId: 'natural-gas', label: 'Natural Gas' });
    expect(resolveSpendTarget('gas')).toEqual({ type: 'category', categoryId: 'fuel', label: 'Fuel' }); // bare "gas" still fuel
    expect(resolveSpendTarget('electricity')).toEqual({ type: 'category', categoryId: 'electricity', label: 'Electricity' });
  });
  // #154 critic P2: "utilities" is an umbrella that must SUM the split-out leaves,
  // else the total silently under-reports. phone/internet/insurance stay excluded.
  it('the "utilities" umbrella sums the whole utility family', () => {
    expect(resolveSpendTarget('how much on utilities')).toEqual({
      type: 'categories',
      categoryIds: ['utilities', 'electricity', 'natural-gas', 'water', 'trash'],
      label: 'utilities',
    });
  });
  it('returns null for non-spend text', () => {
    expect(resolveSpendTarget('what is my net worth')).toBeNull();
  });
});

describe('validateIntent (zod-substitute gate)', () => {
  it('accepts well-formed intents', () => {
    expect(validateIntent({ kind: 'net_worth' })).toEqual({ kind: 'net_worth' });
    expect(
      validateIntent({
        kind: 'spend_by_category',
        timeframe: { fromYm: '2026-05', toYm: '2026-05', label: 'last month' },
        target: { type: 'category', categoryId: 'groceries', label: 'Groceries' },
      }),
    ).not.toBeNull();
  });
  it('rejects malformed / hallucinated intents', () => {
    expect(validateIntent(null)).toBeNull();
    expect(validateIntent({ kind: 'drop_table' })).toBeNull();
    expect(validateIntent({ kind: 'spend_by_category', timeframe: { fromYm: '2026-05', toYm: '2026-05', label: 'x' }, target: { type: 'category', categoryId: 'NOT_A_CATEGORY', label: 'x' } })).toBeNull();
    expect(validateIntent({ kind: 'spend_total', timeframe: { fromYm: 'bad', toYm: '2026-05', label: 'x' } })).toBeNull();
    expect(validateIntent({ kind: 'spend_total' })).toBeNull(); // missing timeframe
  });
});

describe('test_regression__ask-partial-match-hijacks (#166 audit P1)', () => {
  // Pre-#166 the parser answered a DIFFERENT question than asked when it only
  // partially matched: an unresolved "at <merchant>" fell through to the
  // all-spending total, and "afford $X in <month>" was answered with this
  // month's plan, discarding both the amount and the date.
  it('"spent AT <merchant>" routes to the per-merchant total (#168, was abstain pre-#168)', () => {
    // #166 abstained here (no merchant intent existed yet); #168 answers the
    // "at X" merchant construction. The all-spending-total hijack the #166 guard
    // prevented must still never happen — these route to merchant_spend.
    expect(parseAssistantQuery('how much did I spend at costco', TODAY).kind).toBe('merchant_spend');
    expect(parseAssistantQuery('what did I spend at round1 last month', TODAY).kind).toBe('merchant_spend');
  });
  it('an unresolved "ON <object>" still abstains — never the all-spending total (#166 invariant, #168)', () => {
    // "on X" leans category. When X is neither a known category nor a total word,
    // abstain honestly instead of (a) answering the whole total [#166 hijack] or
    // (b) treating a category-word as a store ["No spending at Golf"]. "on average"
    // is likewise not a merchant.
    expect(parseAssistantQuery('how much did I spend on golf', TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery('how much do I spend on average', TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery('what do I spend on average per month', TODAY).kind).toBe('unknown');
  });
  it('a payment METHOD after "with" is not a merchant and abstains (#168 P2)', () => {
    // "spend WITH my card / with venmo" names the tender, not a store — routing it
    // to merchant_spend would answer a confident-wrong "No spending at Card".
    expect(parseAssistantQuery('how much did I spend with my card this month', TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery('how much did I spend with venmo', TODAY).kind).toBe('unknown');
    // but a real store after "with" still routes to the merchant total
    expect(parseAssistantQuery('what did I spend with costco this month', TODAY).kind).toBe('merchant_spend');
  });
  it('"afford $X in <month>" routes to the savings-goal solver with BOTH params', () => {
    const i = parseAssistantQuery('can I afford a $3000 vacation in september', TODAY);
    expect(i.kind).toBe('savings_goal_by_date');
    if (i.kind === 'savings_goal_by_date') {
      expect(i.targetCents).toBe(300000);
      expect(i.targetDate.startsWith('2026-09')).toBe(true);
    }
  });
  it('critic F1/F2: current-month and bill affordability stay on the affordability answer', () => {
    // "this month" is EXACTLY what safe_to_spend answers; rerouting it to the
    // savings solver produced a "too soon to save" refusal (critic cycle 1).
    expect(parseAssistantQuery('can I afford to spend $200 on groceries this month', TODAY).kind).toBe('safe_to_spend');
    expect(parseAssistantQuery('can I afford $1000 this month', TODAY).kind).toBe('safe_to_spend');
    // A recurring obligation is not a savings goal ("afford my rent in July"
    // must not become a 12-month drip plan toward July 2027).
    expect(parseAssistantQuery('can I afford my $1,800 rent in july', TODAY).kind).toBe('safe_to_spend');
    expect(parseAssistantQuery('can I afford my $250 credit card payment in august', TODAY).kind).toBe('safe_to_spend');
  });

  it('critic F7: total-meaning and month objects after on/at keep the total answer', () => {
    expect(parseAssistantQuery('how much did I spend on everything last month', TODAY).kind).toBe('spend_total');
    expect(parseAssistantQuery('what did I spend in total on everything', TODAY).kind).toBe('spend_total');
    expect(parseAssistantQuery('how much did I spend on march 5', TODAY).kind).toBe('spend_total');
  });

  it('plain and category spend questions are unchanged', () => {
    expect(parseAssistantQuery('how much did I spend last month', TODAY).kind).toBe('spend_total');
    expect(parseAssistantQuery('how much did I spend on groceries last month', TODAY).kind).toBe('spend_by_category');
    expect(parseAssistantQuery('can I afford a $50 dinner tonight', TODAY).kind).toBe('safe_to_spend');
  });

  it('test_regression__o10a_costco_gas_is_not_hijacked_by_fuel_synonym', () => {
    // Fail-old: resolveSpendTarget ran on the whole question and `\bgas\b`→fuel
    // won before merchant_spend, so Ask "at Costco Gas" answered the Fuel
    // category total ($68.27 on demo) instead of the store. Multi-word at/with
    // stores keep merchant_spend unless a synonym owns the WHOLE phrase.
    expect(parseAssistantQuery('How much did I spend at Costco Gas this month?', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'costco gas',
    });
    expect(parseAssistantQuery('how much did I spend at amazon prime this month', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'amazon prime',
    });
    // Bare / whole-phrase synonyms still win (DECISIONS #168 + #154).
    expect(parseAssistantQuery('how much did I spend on gas this month', TODAY)).toMatchObject({
      kind: 'spend_by_category',
      target: { type: 'category', categoryId: 'fuel' },
    });
    expect(parseAssistantQuery('how much did I spend at Amazon this month', TODAY)).toMatchObject({
      kind: 'spend_by_category',
      target: { type: 'group', group: 'Shopping' },
    });
    expect(parseAssistantQuery('how much did I spend on natural gas this month', TODAY)).toMatchObject({
      kind: 'spend_by_category',
      target: { type: 'category', categoryId: 'natural-gas' },
    });
    expect(parseAssistantQuery('how much did I spend at Uber Eats this month', TODAY)).toMatchObject({
      kind: 'spend_by_category',
      target: { type: 'category', categoryId: 'food-delivery' },
    });
  });

  it('test_regression__spend_at_non_ascii_merchant (#226): abstains, never the all-spending total', () => {
    // Both #166 guards are ASCII-only — `extractMerchantPhrase` strips every
    // non-[a-z0-9'&.-] character, and the `on <object>` guard matches `[a-z0-9]+` —
    // so a store or category named in a non-Latin script tokenized to NOTHING and fell
    // through to `spend_total`: the user's TOTAL spending, answered to a question about
    // ONE store, with no hedge. A true figure under a false question. Abstain instead.
    expect(parseAssistantQuery('how much did I spend at 星巴克 last month', TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery('how much did I spend with Zürich Café last month', TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery('how much did I spend on 食料品 last month', TODAY).kind).toBe('unknown');
    // …while every ASCII phrasing keeps the route it had.
    expect(parseAssistantQuery('how much did I spend at Costco last month', TODAY).kind).toBe('merchant_spend');
    expect(parseAssistantQuery('how much did I spend on everything last month', TODAY).kind).toBe('spend_total');
    expect(parseAssistantQuery('did I spend at all last month', TODAY).kind).toBe('spend_total');
  });

  it('test_regression__unreadable_merchant_behind_an_article (#226 cycle 2)', () => {
    // The cycle-1 guard read the FIRST token after the preposition; the tokenizer skips
    // leading articles first. So the identical harm was one article away: "at THE 星巴克"
    // sailed past the guard, tokenized to nothing, and answered the ALL-spending total.
    // Guard and tokenizer now walk the same token stream.
    for (const q of [
      'how much did I spend at the 星巴克 last month',
      'how much did I spend at a 星巴克 last month',
      'how much did I spend at my 田中 store last month',
      'how much did I spend at the café zurich last month', // mangled to "caf zurich" before
    ]) {
      expect(parseAssistantQuery(q, TODAY).kind, q).toBe('unknown');
    }
  });

  it('test_regression__unreadable_merchant_glued_to_a_stop_word (#226 cycle 3)', () => {
    // The cycle-2 guard tested the STRIPPED token — and "星巴克last" strips to "last", a
    // timeframe cue, so the scan terminated before the guard ever saw the raw bytes and
    // the all-spending total came back. A missing space between an IME and a Latin word
    // is the canonical typo for exactly the users this guard exists for. The raw token
    // is now tested FIRST, always.
    for (const q of [
      'how much did i spend at 星巴克last month', // strips to the stop word "last"
      'how much did i spend at 星巴克total', // strips to a TOTAL_SPEND_OBJECT
      'how much did i spend at 星巴克may', // strips to a month name
      'how much did i spend at , 星巴克', // punctuation-only token ended the scan
      'how much did i spend at trader 星巴克 last month', // unreadable in token 2
    ]) {
      expect(parseAssistantQuery(q, TODAY).kind, q).toBe('unknown');
    }
  });

  it('test_regression__unreadable_guard_refuses_only_NAME_content (#226 cycle 3)', () => {
    // The guard must refuse only what it cannot READ. A quote, a dash, an emoji carries
    // no name content the tokenizer would drop, so abstaining on it would refuse
    // questions we answer perfectly well — the same class of self-inflicted regression
    // the curly apostrophe was (cycle 2).
    expect(parseAssistantQuery('how much did I spend at “costco” last month', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'costco',
    });
    expect(parseAssistantQuery('how much did I spend at costco 🎉 last month', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'costco',
    });
    // A non-ASCII character AFTER the object ended is not part of the name.
    expect(parseAssistantQuery('how much did I spend at costco last month 🎉', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'costco',
    });
  });

  it('test_regression__object_that_strips_to_nothing (#226 cycle 4, P0)', () => {
    // A store written in glyphs the tokenizer DELETES: enclosed alphanumerics, emoji.
    // These are symbols, not letters, so the (deliberately narrow) name-char predicate
    // says nothing about them — and the object vanished, landing on the ALL-spending
    // total. The question that matters is not "is there a symbol?" but "did the object
    // survive being read?".
    for (const q of [
      'how much did i spend at ⓒⓞⓢⓣⓒⓞ',
      'how much did i spend at 🅲🅾🆂🆃🅲🅾',
      'how much did i spend at 🍕',
      'how much did i spend on 🍕',
      'how much did i spend on ⓖⓡⓞⓒⓔⓡⓘⓔⓢ',
    ]) {
      expect(parseAssistantQuery(q, TODAY).kind, q).toBe('unknown');
    }
    // …while a symbol NEXT TO a readable name keeps its answer (no false abstain).
    expect(parseAssistantQuery('how much did I spend at costco 🎉 last month', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: 'costco',
    });
    // An unreadable name past the tokenizer's 4-token window is still the store the user
    // asked about — answering for the first four words would name a shop they never said.
    expect(parseAssistantQuery('how much did i spend at big apple corner store 星巴克', TODAY).kind).toBe('unknown');
  });

  it('test_regression__nfd_accents_cannot_reach_the_category_route (#226 cycle 4, P0)', () => {
    // DECOMPOSED "café" is "cafe" + U+0301, and a combining mark is not a word char — so
    // `\bcafe\b` matched it and the question about ONE STORE was answered with ALL
    // coffee-shop spending, while the composed spelling of the same question abstained.
    // Two byte sequences the user cannot tell apart must not route differently.
    const base = 'how much did i spend at café zurich';
    const nfd = base.normalize('NFD');
    const nfc = base.normalize('NFC');
    expect(nfd).not.toBe(nfc); // genuinely different bytes…
    // …and they must ROUTE the same. (The echoed `question` keeps the user's own bytes,
    // so only the routing DECISION is compared.)
    expect(parseAssistantQuery(nfd, TODAY).kind).toBe('unknown');
    expect(parseAssistantQuery(nfc, TODAY).kind).toBe('unknown');
  });

  it('test_regression__fronted_and_split_unreadable_objects (#226 cycle 4, P1)', () => {
    // Every guard was scoped to one sentence shape (verb → preposition → object). The
    // input just moved: a fronted object, a sentence break, a zero-width space glued to
    // the preposition. `spend_total` is the SINK of this family and must earn its answer.
    for (const q of [
      'at 星巴克, how much did i spend?',
      'i spent so much. at 星巴克 how much?',
      'how much did i spend at​星巴克', // ZWSP instead of a space
    ]) {
      expect(parseAssistantQuery(q, TODAY).kind, q).toBe('unknown');
    }
  });

  it('test_regression__smart_apostrophe_merchant_still_resolves (#226 cycle 2)', () => {
    // A curly apostrophe is non-ASCII but carries no meaning — it is what the iOS
    // keyboard types by default. The cycle-1 guard abstained on it, silently breaking
    // every phone-typed possessive store name (and the LLM cannot rescue it: the
    // classifier is never offered `merchant_spend`). Folded to ASCII before the test.
    const curly = parseAssistantQuery('how much did I spend at mcdonald’s last month', TODAY);
    expect(curly.kind).toBe('merchant_spend');
    expect(curly).toMatchObject({ merchant: "mcdonald's" });
    // …and it lands on the same key as the straight-quote spelling.
    expect(parseAssistantQuery('how much did I spend at mcdonald\'s last month', TODAY)).toEqual(curly);
    expect(parseAssistantQuery('how much did I spend at trader joe’s last month', TODAY)).toMatchObject({
      kind: 'merchant_spend',
      merchant: "trader joe's",
    });
  });
});
