/**
 * Locks for `registerEmptyReason` — WHICH zero the register prints.
 *
 * The owner's live shape is the first test and it is the reason the module
 * exists: a custom window of Aug 6 2024 → Aug 6 2025 against a register whose
 * history starts Mar 25 2026 printed "No transactions match these filters"
 * while "History available from Wed, Mar 25, 2026" sat four lines above it.
 */
import { describe, it, expect } from 'vitest';
import { registerEmptyReason, isWindowExplainedZero } from '@/lib/engine/transactions/empty-reason';

/** Defaults matching a register with a year of history and no filters on. */
const base = {
  hasFilters: false,
  from: null as string | null,
  to: null as string | null,
  oldest: '2026-03-25' as string | null,
  newest: '2026-08-05' as string | null,
  merchant: null as string | null,
  otherFilters: false,
};

describe('registerEmptyReason', () => {
  it("the owner's live window (Aug 2024 → Aug 2025 on history starting Mar 25 2026) names the history bound, not the filters", () => {
    const r = registerEmptyReason({
      ...base,
      hasFilters: true,
      from: '2024-08-06',
      to: '2025-08-06',
    });
    expect(r).toEqual({ kind: 'before-history', oldest: '2026-03-25', to: '2025-08-06' });
  });

  it('K.4/F10 shape: with the SCOPED bound, before-history fires where the global bound could not (DECISIONS #436)', () => {
    // Reader narrowed to the card whose history starts 2026-07-01, "Last year"
    // window [2025-01-01..2025-12-31]. Unscoped, the register would pass the
    // GLOBAL oldest (2024-08-11, another card): to > oldest, the window looks
    // in-range, the answer blamed the filters, and the printed line above the
    // box was not about the view — the K.3 pair broken one filter away. With
    // the K.4 scoped bound the window IS disjoint from the browsed set, and
    // this branch — which exists to name exactly this zero — fires.
    const r = registerEmptyReason({
      ...base,
      hasFilters: true,
      from: '2025-01-01',
      to: '2025-12-31',
      oldest: '2026-07-01',
    });
    expect(r).toEqual({ kind: 'before-history', oldest: '2026-07-01', to: '2025-12-31' });
  });

  it('carries BOTH dates it compared, so the copy can state the comparison rather than assert a bare bound', () => {
    const r = registerEmptyReason({ ...base, hasFilters: true, from: '2024-01-01', to: '2024-12-31' });
    if (r.kind !== 'before-history') throw new Error(`expected before-history, got ${r.kind}`);
    expect(r.to).toBe('2024-12-31');
    expect(r.oldest).toBe('2026-03-25');
  });

  it('an open-ended window (only `to` set) still resolves to the history bound', () => {
    const r = registerEmptyReason({ ...base, hasFilters: true, to: '2025-01-01' });
    expect(r.kind).toBe('before-history');
  });

  it('the mirror case: a window starting after the newest row names the newest row', () => {
    const r = registerEmptyReason({ ...base, hasFilters: true, from: '2026-09-01', to: '2026-09-30' });
    expect(r).toEqual({ kind: 'after-history', newest: '2026-08-05', from: '2026-09-01' });
  });

  it('a window that TOUCHES the boundary is not disjoint — `to` exactly on the oldest row is a real match window', () => {
    const r = registerEmptyReason({ ...base, hasFilters: true, from: '2024-01-01', to: '2026-03-25' });
    expect(r.kind).toBe('filters');
  });

  it('a window that touches the newest row is likewise not disjoint', () => {
    const r = registerEmptyReason({ ...base, hasFilters: true, from: '2026-08-05', to: '2026-12-31' });
    expect(r.kind).toBe('filters');
  });

  it('a window INSIDE the span that matched nothing is still a filters answer — the register really did look', () => {
    const r = registerEmptyReason({ ...base, hasFilters: true, from: '2026-05-01', to: '2026-05-31' });
    expect(r.kind).toBe('filters');
  });

  it('a non-date filter with no window keeps the #186 answer', () => {
    expect(registerEmptyReason({ ...base, hasFilters: true }).kind).toBe('filters');
  });

  it('no filters and no rows keeps the #186 empty-register answer', () => {
    expect(registerEmptyReason({ ...base, oldest: null, newest: null }).kind).toBe('no-rows-yet');
  });

  it('an EMPTY register with a window set keeps #186 verbatim — widening that is a separate decision', () => {
    const r = registerEmptyReason({
      ...base,
      hasFilters: true,
      from: '2024-08-06',
      to: '2025-08-06',
      oldest: null,
      newest: null,
    });
    expect(r.kind).toBe('filters');
  });

  it('an EMPTY-STRING bound is absent, not a date — the page reads `str(sp.to)`, which is "" when unset', () => {
    // Regression: passing the raw '' through would reach isoDate(''), which
    // THROWS, turning every unfiltered register load into a server error.
    expect(() => registerEmptyReason({ ...base, from: '', to: '' })).not.toThrow();
    expect(registerEmptyReason({ ...base, from: '', to: '' }).kind).toBe('no-rows-yet');
  });

  it('an unparseable URL bound degrades to the #186 answer instead of throwing the page', () => {
    // `?to=banana` is reachable — nothing upstream validates these params.
    expect(() => registerEmptyReason({ ...base, hasFilters: true, to: 'banana' })).not.toThrow();
    expect(registerEmptyReason({ ...base, hasFilters: true, to: 'banana' }).kind).toBe('filters');
    expect(registerEmptyReason({ ...base, hasFilters: true, from: '2026-13-45' }).kind).toBe('filters');
  });

  // ── critic cycle 1 ──────────────────────────────────────────────────────────

  it('F3: a window that ends before it starts is named as such, NOT as history-depth', () => {
    // Before the fix this returned before-history, so the reader was told to
    // import older data — a remedy that provably cannot empty-proof this window.
    const r = registerEmptyReason({ ...base, hasFilters: true, from: '2026-08-01', to: '2024-01-01' });
    expect(r).toEqual({ kind: 'inverted-window', from: '2026-08-01', to: '2024-01-01' });
  });

  it('F3: an inverted window is decided WITHOUT the data — it holds nothing however much history exists', () => {
    const withHistory = registerEmptyReason({ ...base, hasFilters: true, from: '2026-08-01', to: '2024-01-01' });
    const withNone = registerEmptyReason({
      ...base,
      hasFilters: true,
      from: '2026-08-01',
      to: '2024-01-01',
      oldest: null,
      newest: null,
    });
    expect(withNone).toEqual(withHistory);
  });

  it('F3: an inverted window inside the span is still inverted, not a filters answer', () => {
    const r = registerEmptyReason({ ...base, hasFilters: true, from: '2026-06-01', to: '2026-05-01' });
    expect(r.kind).toBe('inverted-window');
  });

  it('a same-day window is NOT inverted — from === to is one real day', () => {
    const r = registerEmptyReason({ ...base, hasFilters: true, from: '2026-05-01', to: '2026-05-01' });
    expect(r.kind).toBe('filters');
  });

  it('F4: `after-history` reads the NEWEST bound, never the oldest', () => {
    // The sabotage this locks: computing newestDate with the oldest-comparison
    // collapses the two, and a reader inside their own history is told their
    // "latest" is the first row we hold. With distinct bounds, a `from` between
    // them must NOT be after-history.
    expect(registerEmptyReason({ ...base, hasFilters: true, from: '2026-05-01' }).kind).toBe('filters');
    expect(registerEmptyReason({ ...base, hasFilters: true, from: '2026-08-06' })).toEqual({
      kind: 'after-history',
      newest: '2026-08-05',
      from: '2026-08-06',
    });
  });

  it('F2: exactly the window kinds are the ones whose zero must be named beside the zero', () => {
    const window = [
      registerEmptyReason({ ...base, hasFilters: true, from: '2026-08-01', to: '2024-01-01' }),
      registerEmptyReason({ ...base, hasFilters: true, to: '2024-01-01' }),
      registerEmptyReason({ ...base, hasFilters: true, from: '2026-09-01' }),
    ];
    for (const r of window) expect(isWindowExplainedZero(r)).toBe(true);
    expect(isWindowExplainedZero(registerEmptyReason({ ...base, hasFilters: true }))).toBe(false);
    expect(isWindowExplainedZero(registerEmptyReason({ ...base }))).toBe(false);
  });

  // ── the merchant axis (owner report 2026-08-07) ─────────────────────────────

  it("the owner's second live shape: a merchant filter and nothing else names the merchant, not 'these filters'", () => {
    // The screen: 0 transactions, $0.00 × 3, every visible control on its
    // default, "History available from Wed, Mar 25, 2026". Before this branch
    // it answered 'filters' — blaming controls the reader could see were all
    // set to All.
    const r = registerEmptyReason({ ...base, hasFilters: true, merchant: 'Truist Mortg Olb Mtgpmt' });
    expect(r).toEqual({ kind: 'merchant', merchant: 'Truist Mortg Olb Mtgpmt', withOtherFilters: false });
  });

  it('says so when the merchant is NOT the only narrowing — the sentence may not claim a cause it did not establish', () => {
    const r = registerEmptyReason({ ...base, hasFilters: true, merchant: 'Peloton', otherFilters: true });
    expect(r).toEqual({ kind: 'merchant', merchant: 'Peloton', withOtherFilters: true });
  });

  it('a window that ends before the first row still wins over the merchant — the date comparison is the certain one', () => {
    // Both are true of this reader; only one is decidable from bounds the
    // register itself loaded, and "import older data" is the remedy that fits.
    const r = registerEmptyReason({
      ...base,
      hasFilters: true,
      merchant: 'Peloton',
      otherFilters: true,
      to: '2025-08-06',
    });
    expect(r.kind).toBe('before-history');
  });

  it('an inverted window wins over the merchant too', () => {
    const r = registerEmptyReason({
      ...base,
      hasFilters: true,
      merchant: 'Peloton',
      otherFilters: true,
      from: '2026-08-01',
      to: '2024-01-01',
    });
    expect(r.kind).toBe('inverted-window');
  });

  it('a merchant param that narrows NOTHING is not a cause — `?merchant=` and whitespace read as off, exactly as the query engine reads them', () => {
    // query.ts: `filter.merchant?.trim().toLowerCase() ?? ''` then `if (merchant …)`.
    // A blank here that this module treated as a filter would print a sentence
    // with empty quotes and blame a filter that matched every row.
    expect(registerEmptyReason({ ...base, hasFilters: true, merchant: '' }).kind).toBe('filters');
    expect(registerEmptyReason({ ...base, hasFilters: true, merchant: '   ' }).kind).toBe('filters');
    expect(registerEmptyReason({ ...base, merchant: null }).kind).toBe('no-rows-yet');
  });

  it('the merchant zero is NOT a window-explained zero — nothing about it belongs on the "in this window" line', () => {
    expect(isWindowExplainedZero(registerEmptyReason({ ...base, hasFilters: true, merchant: 'Peloton' }))).toBe(false);
  });

  it('the merchant name is carried VERBATIM, so the copy can quote the string actually being matched', () => {
    const r = registerEmptyReason({ ...base, hasFilters: true, merchant: 'SQ *BLUE BOTTLE 0042 OAK' });
    if (r.kind !== 'merchant') throw new Error(`expected merchant, got ${r.kind}`);
    expect(r.merchant).toBe('SQ *BLUE BOTTLE 0042 OAK');
  });

  it('never claims a window is disjoint when the register holds no bound to compare against', () => {
    // `oldest` present but `newest` null cannot happen from one scan; the guard
    // is per-comparison so a half-populated input degrades to #186, never to a
    // sentence naming a bound that does not exist.
    expect(registerEmptyReason({ ...base, hasFilters: true, from: '2027-01-01', newest: null }).kind).toBe('filters');
  });
});
