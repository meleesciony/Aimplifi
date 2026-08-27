/**
 * P.3 — the C2 dashboard cushion line: pairs the radar's projected dip with the
 * reader's own runway cushion (COACH_PRINCIPLES_PLAN.md §4 Dashboard row).
 * Engine-first: the composer is pure; nothing here reads a DB. The one
 * demo-backed test pins what the dashboard line needs — a finite positive
 * runway on the shared demo, where the e2e asserts the rendered line.
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { cushionLineFor } from '@/lib/engine/radar/cushion-line';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { getCoachData } from '@/server/coach';

describe('cushion line — pair the radar dip with the runway cushion', () => {
  it('alert + dip + positive runway → the C2 sentence carrying the months', () => {
    expect(cushionLineFor('alert', isoDate('2026-06-24'), 2.1)).toBe(
      COACH_COPY.cushionLine(2.1),
    );
    expect(cushionLineFor('alert', isoDate('2026-06-24'), 2.1)).toContain(
      '2.1-month cushion',
    );
    expect(cushionLineFor('alert', isoDate('2026-06-24'), 2.1)).toContain(
      'Surprises are what history guarantees',
    );
  });

  it('a whole month keeps the singular "1-month" form', () => {
    expect(cushionLineFor('alert', isoDate('2026-06-24'), 1)).toContain('1-month cushion');
  });

  it('no dip printed → no line: ok, watch, and alert with no date', () => {
    expect(cushionLineFor('ok', null, 2.1)).toBeNull();
    expect(cushionLineFor('watch', null, 2.1)).toBeNull();
    expect(cushionLineFor('alert', null, 2.1)).toBeNull();
  });

  it('an unbounded, zero, negative or absent cushion is not a cushion to name', () => {
    expect(cushionLineFor('alert', isoDate('2026-06-24'), Infinity)).toBeNull();
    expect(cushionLineFor('alert', isoDate('2026-06-24'), 0)).toBeNull();
    expect(cushionLineFor('alert', isoDate('2026-06-24'), -2.3)).toBeNull();
    expect(cushionLineFor('alert', isoDate('2026-06-24'), null)).toBeNull();
  });

  it('test_regression__cushion_line_never_claims_the_cushion_covers_the_shown_dip', () => {
    // The cover transfer above the line handles the KNOWN dip; this sentence is
    // about what no forecast sees. It must not name the dip its own gate saw,
    // nor admit a claim of coverage ("handles this" / "covers it").
    const line = cushionLineFor('alert', isoDate('2026-06-24'), 2.1)!;
    expect(line).toContain('what no forecast sees');
    expect(line).not.toContain('2026-06-24');
    expect(line).not.toMatch(/this dip|covers it|handles it/);
  });

  it('the demo dashboard has the finite positive runway the line needs', async () => {
    const d = await getCoachData(DEMO_USER_ID);
    expect(Number.isFinite(d.runwayMonths) && d.runwayMonths > 0).toBe(true);
  });
});
