/**
 * Period presets (owner request 2026-08-04: "still need a way to view last
 * month, last quarter, last year"). Every expectation below is HAND-VERIFIED
 * calendar math — the presets exist to make date windows unambiguous, so the
 * tests state the exact dates each phrase means (CLAUDE.md rule 3; see
 * docs/EDGE_CASES.md "Period presets").
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import {
  PERIOD_PRESETS,
  matchPeriodPreset,
  presetWindow,
} from '@/lib/engine/transactions/presets';

// A mid-quarter, mid-month Tuesday — no boundary aligned.
const TODAY = isoDate('2026-08-04');

describe('presetWindow — mid-period today (2026-08-04)', () => {
  it('this month is the calendar month to date', () => {
    expect(presetWindow('this-month', TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-04' });
  });

  it('last month is the completed calendar month before this one', () => {
    expect(presetWindow('last-month', TODAY)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('past 3 months rolls back three calendar months, ending today', () => {
    expect(presetWindow('last-3-months', TODAY)).toEqual({ from: '2026-05-05', to: '2026-08-04' });
  });

  it('last quarter is the completed calendar quarter (Aug 2026 → Apr–Jun 2026)', () => {
    expect(presetWindow('last-quarter', TODAY)).toEqual({ from: '2026-04-01', to: '2026-06-30' });
  });

  it('past 12 months rolls back a year, ending today', () => {
    expect(presetWindow('last-12-months', TODAY)).toEqual({ from: '2025-08-05', to: '2026-08-04' });
  });

  it('year to date starts Jan 1 of the current year', () => {
    expect(presetWindow('ytd', TODAY)).toEqual({ from: '2026-01-01', to: '2026-08-04' });
  });

  it('last year is the completed calendar year', () => {
    expect(presetWindow('last-year', TODAY)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('all time sets no window at all', () => {
    expect(presetWindow('all-time', TODAY)).toEqual({ from: null, to: null });
  });
});

describe('presetWindow — year boundaries (2026-01-15)', () => {
  const JAN = isoDate('2026-01-15');

  it('last month crosses into the previous year', () => {
    expect(presetWindow('last-month', JAN)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('last quarter from Q1 is the previous year\'s Q4', () => {
    expect(presetWindow('last-quarter', JAN)).toEqual({ from: '2025-10-01', to: '2025-12-31' });
  });

  it('past 12 months crosses the year boundary', () => {
    expect(presetWindow('last-12-months', JAN)).toEqual({ from: '2025-01-16', to: '2026-01-15' });
  });

  it('ytd in mid-January is two weeks', () => {
    expect(presetWindow('ytd', JAN)).toEqual({ from: '2026-01-01', to: '2026-01-15' });
  });
});

describe('presetWindow — quarter boundaries and leap years', () => {
  it('on the first day of a quarter, last quarter is the three months just ended', () => {
    expect(presetWindow('last-quarter', isoDate('2026-04-01'))).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
    });
    expect(presetWindow('last-quarter', isoDate('2026-07-01'))).toEqual({
      from: '2026-04-01',
      to: '2026-06-30',
    });
  });

  it('last month in a leap year reaches Feb 29', () => {
    expect(presetWindow('last-month', isoDate('2024-03-10'))).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    });
  });

  it('rolling windows clamp the day when the target month is shorter', () => {
    // May 31 minus 3 months is Feb 31, which clamps to Feb 29 (2024 is leap);
    // the window then starts the NEXT day. Deterministic, documented, tested.
    expect(presetWindow('last-3-months', isoDate('2024-05-31'))).toEqual({
      from: '2024-03-01',
      to: '2024-05-31',
    });
  });
});

describe('matchPeriodPreset — the dropdown always names the actual window', () => {
  it('round-trips every preset: window → preset', () => {
    for (const preset of PERIOD_PRESETS) {
      const w = presetWindow(preset, TODAY);
      expect(matchPeriodPreset(w.from ?? '', w.to ?? '', TODAY)).toBe(preset);
    }
  });

  it('reads custom for a window no preset produces', () => {
    expect(matchPeriodPreset('2026-01-05', '2026-02-10', TODAY)).toBe('custom');
  });

  it('reads custom when only one bound is set', () => {
    expect(matchPeriodPreset('2026-01-01', '', TODAY)).toBe('custom');
    expect(matchPeriodPreset('', '2026-02-01', TODAY)).toBe('custom');
  });

  it('reads all-time when neither bound is set', () => {
    expect(matchPeriodPreset('', '', TODAY)).toBe('all-time');
  });
});
