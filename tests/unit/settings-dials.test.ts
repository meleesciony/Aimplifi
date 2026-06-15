/**
 * Money Dials engine — exhaustive table-driven tests for the pure
 * validation/normalization that turns raw form strings into the typed
 * swrBps/expectedReturnBps/hourlyWageCents the FI + cash-needed engines consume.
 * Hand-verified expected values mirror docs/EDGE_CASES.md §Money-Dials.
 */
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';
import { fiNumberCents } from '@/lib/engine/fi/fi';
import {
  DIAL_LIMITS,
  bpsFromPercentString,
  bpsToPercentInput,
  centsFromWageString,
  centsToDollarInput,
  encodeDials,
  needsOnboarding,
  normalizeMoneyDials,
  parseStoredDials,
  validateDials,
  type RawDials,
} from '@/lib/engine/settings/dials';

const ELIGIBLE = [
  { id: 'acct-checking', type: 'CHECKING' },
  { id: 'acct-savings', type: 'SAVINGS' },
  { id: 'acct-joint', type: 'CHECKING' },
] as const;

// The seed's demo-user dials — the validator must accept them unchanged.
const SEED_DIALS: RawDials = {
  wage: '38',
  swr: '4',
  expectedReturn: '7',
  moneyDials: 'Travel, Dining Out',
  paymentAccountId: 'acct-checking',
};

describe('bpsFromPercentString', () => {
  const cases: [string, number | null][] = [
    ['4', 400],
    ['4.0', 400],
    ['4.00', 400],
    ['4.25', 425],
    ['4.5', 450],
    ['7', 700],
    ['10', 1000],
    ['0', 0],
    ['0.5', 50],
    ['7%', 700],
    [' 6.5 ', 650],
    ['6.5%', 650],
    [' 7 % ', 700],
    ['100', 10000], // 3 digits parse (then bounds-rejected by validateDials)
    ['1000', null], // 4 integer digits — malformed (no credible percent is ≥ 1000%)
    ['', null],
    ['abc', null],
    ['-4', null],
    ['4.255', null], // > 2 decimals
    ['4.', null],
    ['4.2.5', null],
    ['%', null],
    ['1,000', null],
  ];
  it.each(cases)('%s -> %s', (input, expected) => {
    expect(bpsFromPercentString(input)).toBe(expected);
  });
});

describe('centsFromWageString', () => {
  const cases: [string, number | null][] = [
    ['38', 3800],
    ['38.50', 3850],
    ['38.5', 3850],
    ['0', 0],
    ['0.05', 5],
    ['10000', 1_000_000],
    ['10000.01', 1_000_001],
    ['-5', -500],
    ['abc', null],
    ['', null],
    ['38.555', null],
    ['$38', null],
  ];
  it.each(cases)('%s -> %s', (input, expected) => {
    expect(centsFromWageString(input)).toBe(expected);
  });
});

describe('normalizeMoneyDials', () => {
  it('splits on commas and newlines, trims, drops empties', () => {
    expect(normalizeMoneyDials('Travel, Dining Out')).toEqual(['Travel', 'Dining Out']);
    expect(normalizeMoneyDials('Travel\nDining Out')).toEqual(['Travel', 'Dining Out']);
    expect(normalizeMoneyDials('  Travel  , , Dining  \n')).toEqual(['Travel', 'Dining']);
  });
  it('dedupes case-insensitively, keeping the first casing', () => {
    expect(normalizeMoneyDials('Travel, travel, TRAVEL')).toEqual(['Travel']);
    expect(normalizeMoneyDials('Coffee, Books, coffee')).toEqual(['Coffee', 'Books']);
  });
  it('strips control characters within an entry', () => {
    expect(normalizeMoneyDials('Tab\there')).toEqual(['Tabhere']);
  });
  it('returns [] for empty / whitespace-only input', () => {
    expect(normalizeMoneyDials('')).toEqual([]);
    expect(normalizeMoneyDials('  ,\n , ')).toEqual([]);
  });
});

describe('validateDials — happy paths', () => {
  it('accepts the seed dials unchanged', () => {
    const r = validateDials(SEED_DIALS, ELIGIBLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      hourlyWageCents: 3800,
      swrBps: 400,
      expectedReturnBps: 700,
      moneyDials: ['Travel', 'Dining Out'],
      paymentAccountId: 'acct-checking',
    });
  });

  it('treats empty wage as cleared (null), other fields still required', () => {
    const r = validateDials({ ...SEED_DIALS, wage: '' }, ELIGIBLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.hourlyWageCents).toBeNull();
  });

  it('accepts 0% expected return (the "no growth assumed" case)', () => {
    const r = validateDials({ ...SEED_DIALS, expectedReturn: '0' }, ELIGIBLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.expectedReturnBps).toBe(0);
  });

  it('accepts empty money dials', () => {
    const r = validateDials({ ...SEED_DIALS, moneyDials: '' }, ELIGIBLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.moneyDials).toEqual([]);
  });

  it('accepts a savings account as the payment source', () => {
    const r = validateDials({ ...SEED_DIALS, paymentAccountId: 'acct-savings' }, ELIGIBLE);
    expect(r.ok).toBe(true);
  });
});

describe('validateDials — boundaries', () => {
  const boundaryOk: [keyof RawDials, string][] = [
    ['swr', '1'], // 100 bps min
    ['swr', '10'], // 1000 bps max
    ['expectedReturn', '0'], // 0 bps min
    ['expectedReturn', '15'], // 1500 bps max
    ['wage', '10000'], // 1,000,000 cents max
    ['wage', '0.01'], // 1 cent min
  ];
  it.each(boundaryOk)('accepts %s = %s at the boundary', (field, value) => {
    expect(validateDials({ ...SEED_DIALS, [field]: value }, ELIGIBLE).ok).toBe(true);
  });

  const boundaryBad: [keyof RawDials, string][] = [
    ['swr', '0'], // 0% — fiNumberCents would divide by zero
    ['swr', '0.99'], // 99 bps just under min
    ['swr', '10.01'], // just over max
    ['expectedReturn', '15.01'], // just over max
    ['wage', '0'], // $0 not allowed (empty clears instead)
    ['wage', '-5'], // negative
    ['wage', '10000.01'], // just over $10k
  ];
  it.each(boundaryBad)('rejects %s = %s past the boundary', (field, value) => {
    const r = validateDials({ ...SEED_DIALS, [field]: value }, ELIGIBLE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[field]).toBeTruthy();
  });
});

describe('validateDials — rejections', () => {
  it('rejects malformed swr / return / wage', () => {
    const r = validateDials(
      { ...SEED_DIALS, swr: 'abc', expectedReturn: 'x', wage: 'nope' },
      ELIGIBLE,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.swr).toBeTruthy();
    expect(r.errors.expectedReturn).toBeTruthy();
    expect(r.errors.wage).toBeTruthy();
  });

  it('rejects an empty payment account', () => {
    const r = validateDials({ ...SEED_DIALS, paymentAccountId: '' }, ELIGIBLE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.paymentAccountId).toBeTruthy();
  });

  it('rejects an account the user does not own / is ineligible', () => {
    const r = validateDials({ ...SEED_DIALS, paymentAccountId: 'acct-someone-else' }, ELIGIBLE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.paymentAccountId).toBeTruthy();
  });

  it('rejects a credit account as the payment source (not in the eligible set)', () => {
    // The server builds `eligibleAccounts` from CHECKING/SAVINGS only, so a
    // credit-card id is simply absent → rejected.
    const r = validateDials({ ...SEED_DIALS, paymentAccountId: 'acct-sapphire' }, ELIGIBLE);
    expect(r.ok).toBe(false);
  });

  it('rejects more than the max number of money dials', () => {
    const many = Array.from({ length: DIAL_LIMITS.dials.maxCount + 1 }, (_, i) => `D${i}`).join(',');
    const r = validateDials({ ...SEED_DIALS, moneyDials: many }, ELIGIBLE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.moneyDials).toBeTruthy();
  });

  it('rejects a money dial that is too long', () => {
    const long = 'x'.repeat(DIAL_LIMITS.dials.maxLen + 1);
    const r = validateDials({ ...SEED_DIALS, moneyDials: long }, ELIGIBLE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.moneyDials).toBeTruthy();
  });

  it('accumulates every field error at once', () => {
    const r = validateDials(
      { wage: 'x', swr: '0', expectedReturn: '99', moneyDials: 'x'.repeat(50), paymentAccountId: '' },
      ELIGIBLE,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(
      ['expectedReturn', 'moneyDials', 'paymentAccountId', 'swr', 'wage'].sort(),
    );
  });
});

describe('validated SWR keeps the FI engine well-defined', () => {
  it('the minimum allowed swrBps is > 0 so fiNumberCents never divides by zero', () => {
    expect(DIAL_LIMITS.swrBps.min).toBeGreaterThan(0);
    const fi = fiNumberCents(cents(1_200_000), DIAL_LIMITS.swrBps.min);
    expect(Number.isFinite(fi)).toBe(true);
    expect(fi).toBe(120_000_000); // $12,000/yr ÷ 1% = $1.2M (10000/100 = 100×)
  });

  it('every value the validator emits is within [min,max] for both rates', () => {
    const r = validateDials(SEED_DIALS, ELIGIBLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.swrBps).toBeGreaterThanOrEqual(DIAL_LIMITS.swrBps.min);
    expect(r.value.swrBps).toBeLessThanOrEqual(DIAL_LIMITS.swrBps.max);
    expect(r.value.expectedReturnBps).toBeGreaterThanOrEqual(DIAL_LIMITS.expectedReturnBps.min);
    expect(r.value.expectedReturnBps).toBeLessThanOrEqual(DIAL_LIMITS.expectedReturnBps.max);
  });
});

describe('display helpers (UI boundary, integer math)', () => {
  it('centsToDollarInput', () => {
    expect(centsToDollarInput(3800)).toBe('38');
    expect(centsToDollarInput(3850)).toBe('38.50');
    expect(centsToDollarInput(5)).toBe('0.05');
    expect(centsToDollarInput(0)).toBe('0');
    expect(centsToDollarInput(1_000_000)).toBe('10000');
  });
  it('bpsToPercentInput', () => {
    expect(bpsToPercentInput(400)).toBe('4');
    expect(bpsToPercentInput(425)).toBe('4.25');
    expect(bpsToPercentInput(1000)).toBe('10');
    expect(bpsToPercentInput(0)).toBe('0');
    expect(bpsToPercentInput(50)).toBe('0.50');
  });
  it('display → parse round-trips', () => {
    for (const bps of [0, 50, 400, 425, 700, 1000, 1500]) {
      expect(bpsFromPercentString(bpsToPercentInput(bps))).toBe(bps);
    }
    for (const c of [1, 5, 3800, 3850, 1_000_000]) {
      expect(centsFromWageString(centsToDollarInput(c))).toBe(c);
    }
  });
});

describe('needsOnboarding', () => {
  it('true only when no payment account is set (no eligible list)', () => {
    expect(needsOnboarding({ paymentAccountId: null })).toBe(true);
    expect(needsOnboarding({ paymentAccountId: 'acct-checking' })).toBe(false);
  });

  it('re-fires when a non-null id no longer resolves to an eligible account', () => {
    const eligible = ['acct-checking', 'acct-savings'];
    expect(needsOnboarding({ paymentAccountId: null }, eligible)).toBe(true);
    expect(needsOnboarding({ paymentAccountId: 'acct-checking' }, eligible)).toBe(false);
    // chosen account was deleted / became ineligible → stale id not in the set
    expect(needsOnboarding({ paymentAccountId: 'acct-deleted' }, eligible)).toBe(true);
    // empty eligible set (e.g. only credit cards) → re-prompt
    expect(needsOnboarding({ paymentAccountId: 'acct-checking' }, [])).toBe(true);
  });
});

describe('parseStoredDials / encodeDials (the stored-column boundary)', () => {
  it('decodes a valid JSON array', () => {
    expect(parseStoredDials('["Travel","Dining Out"]')).toEqual(['Travel', 'Dining Out']);
  });
  it('returns [] for null/undefined/empty', () => {
    expect(parseStoredDials(null)).toEqual([]);
    expect(parseStoredDials(undefined)).toEqual([]);
    expect(parseStoredDials('')).toEqual([]);
  });
  it('returns [] (never throws) on malformed or non-array JSON', () => {
    expect(parseStoredDials('not json')).toEqual([]);
    expect(parseStoredDials('{"a":1}')).toEqual([]);
    expect(parseStoredDials('42')).toEqual([]);
    expect(parseStoredDials('"Travel"')).toEqual([]);
  });
  it('drops non-string members', () => {
    expect(parseStoredDials('["Travel",3,null,"Books"]')).toEqual(['Travel', 'Books']);
  });
  it('encodeDials: [] -> null, non-empty -> JSON, and round-trips', () => {
    expect(encodeDials([])).toBeNull();
    expect(encodeDials(['Travel'])).toBe('["Travel"]');
    for (const list of [[], ['Travel'], ['Travel', 'Dining Out']]) {
      expect(parseStoredDials(encodeDials(list))).toEqual(list);
    }
  });
});

describe('validateDials — unicode + whitespace-only edge cases', () => {
  it('counts dial length in code points, not UTF-16 units', () => {
    // 8 multi-code-unit emoji = 8 visible chars, well under the 40 limit
    const eightEmoji = '😀😀😀😀😀😀😀😀';
    const r = validateDials({ ...SEED_DIALS, moneyDials: eightEmoji }, ELIGIBLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.moneyDials).toEqual([eightEmoji]);
  });
  it('rejects a dial whose code-point length exceeds the limit even if emoji', () => {
    const tooMany = '😀'.repeat(DIAL_LIMITS.dials.maxLen + 1);
    const r = validateDials({ ...SEED_DIALS, moneyDials: tooMany }, ELIGIBLE);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.moneyDials).toBeTruthy();
  });
  it('rejects whitespace-only required rate fields (not just non-numeric)', () => {
    for (const field of ['swr', 'expectedReturn'] as const) {
      const r = validateDials({ ...SEED_DIALS, [field]: '   ' }, ELIGIBLE);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.errors[field]).toBeTruthy();
    }
  });
  it('treats whitespace-only wage as cleared (optional field → null)', () => {
    const r = validateDials({ ...SEED_DIALS, wage: '   ' }, ELIGIBLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.hourlyWageCents).toBeNull();
  });
});
