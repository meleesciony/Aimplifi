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

  it('never claims a window is disjoint when the register holds no bound to compare against', () => {
    // `oldest` present but `newest` null cannot happen from one scan; the guard
    // is per-comparison so a half-populated input degrades to #186, never to a
    // sentence naming a bound that does not exist.
    expect(registerEmptyReason({ ...base, hasFilters: true, from: '2027-01-01', newest: null }).kind).toBe('filters');
  });
});
