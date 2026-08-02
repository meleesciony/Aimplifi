/**
 * C.3 — Trends labels shared by the dashboard card and /trends.
 *
 * Locks: the day-count phrase that hid the pace divisor, the zero-delta
 * relation that used to read "on pace for $0.00 less" in green, and the mover
 * window so a July fact cannot sit under an August headline unlabeled.
 */
import { describe, expect, it } from 'vitest';
import {
  baselineLabel,
  moverWindowLabel,
  PACE_ASSUMPTION,
  paceDaysPhrase,
  paceDeltaRelation,
  shortMonth,
} from '@/lib/engine/trends/labels';

describe('paceDaysPhrase', () => {
  it('names the singular day', () => {
    expect(paceDaysPhrase(1)).toBe('in the first 1 day');
  });

  it('names the plural days — the owner-reported shape', () => {
    expect(paceDaysPhrase(2)).toBe('in the first 2 days');
  });
});

describe('paceDeltaRelation', () => {
  it('higher projection → more', () => {
    expect(paceDeltaRelation(1971385)).toEqual({ absCents: 1971385, relation: 'more' });
  });

  it('lower projection → less', () => {
    expect(paceDeltaRelation(-5000)).toEqual({ absCents: 5000, relation: 'less' });
  });

  it('exact tie is its own relation — not "less" and not green', () => {
    expect(paceDeltaRelation(0)).toEqual({ absCents: 0, relation: 'same' });
  });
});

describe('baselineLabel / moverWindowLabel', () => {
  it('reads a 3-month baseline oldest→newest', () => {
    // Engine order is most-recent-first. formatMonth('short') includes the year.
    expect(baselineLabel(['2026-06', '2026-05', '2026-04'])).toBe("Apr '26–Jun '26");
  });

  it('labels the mover window the way /trends already does', () => {
    expect(moverWindowLabel('2026-07', ['2026-06', '2026-05', '2026-04'])).toBe(
      "Jul '26 vs Apr '26–Jun '26 average",
    );
  });

  it('refuses a window when there is no compared month', () => {
    expect(moverWindowLabel(null, ['2026-06'])).toBeNull();
  });

  it('shortMonth is formatMonth short', () => {
    expect(shortMonth('2026-08')).toBe("Aug '26");
  });
});

describe('PACE_ASSUMPTION', () => {
  it('states the daily-rate premise and that it is not a prediction', () => {
    expect(PACE_ASSUMPTION).toContain('current daily rate');
    expect(PACE_ASSUMPTION).toContain('a projection, not a prediction');
  });
});
