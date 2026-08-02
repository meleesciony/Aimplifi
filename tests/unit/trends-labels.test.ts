/**
 * C.3 — Trends labels shared by the dashboard card and /trends.
 *
 * Locks: the day-count phrase that hid the pace divisor, the zero-delta
 * relation that used to read "on pace for $0.00 less" in green, and the mover
 * window so a July fact cannot sit under an August headline unlabeled.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  baselineLabel,
  moverWindowLabel,
  PACE_ASSUMPTION,
  PACE_NO_SPEND_YET,
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

describe('PACE_NO_SPEND_YET (C.1)', () => {
  it('names what the app can prove — counted, never "you spent nothing"', () => {
    expect(PACE_NO_SPEND_YET).toBe(
      'No spending counted yet this month — there is no daily rate to project from.',
    );
    expect(PACE_NO_SPEND_YET).not.toMatch(/you (have not|haven't|didn't)/i);
  });

  /**
   * Both surfaces render this sentence, and the dashboard card is where the
   * drift started: it carried its own "Not enough activity yet to spot trends",
   * which C.1 makes false on the first days of most months because the
   * biggest-change row beneath it keeps rendering completed-month facts. One
   * author for the sentence, and the two surfaces locked against each other.
   */
  it('is the single author of the abstention copy on both surfaces', () => {
    const files = [
      'src/components/finance/spending-insights-card.tsx',
      'src/components/finance/trends-view.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src, `${f} must render the shared constant`).toContain('PACE_NO_SPEND_YET');
      expect(src, `${f} must not hard-code its own abstention sentence`).not.toContain(
        'Not enough activity yet',
      );
    }
  });
});
