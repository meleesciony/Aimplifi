/**
 * C5 time-window-of-life line (DECISIONS #524) — the last named gap of the
 * coach-principles plan's C5 row: the one-line's "buy experiences while you
 * can" framing ("Partial — no 'memory dividend' / time-window-of-life
 * framing"). P2.2 shipped the memory-dividend reflection; this closes the
 * time-window half. Engine-first: the picker is pure; nothing here reads a
 * DB. The one demo-backed test pins what the life-energy card needs — a
 * purchase in the 90-day window on the shared demo, where the e2e asserts
 * the rendered line.
 */
import { describe, expect, it } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';
import { windowLineFor } from '@/lib/engine/fi/experiences-window';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { getCoachData } from '@/server/coach';

describe('window line — C5 time-window-of-life framing', () => {
  it('a card with purchases renders the line', () => {
    expect(windowLineFor(5)).toBe(COACH_COPY.experiencesWindow());
  });

  it('an empty list is an absence: no "savor the moment" line against "No large purchases"', () => {
    expect(windowLineFor(0)).toBeNull();
  });

  it('test_regression__experiences_window_line_is_pinned_byte_exact', () => {
    const text = windowLineFor(3)!;
    const pinned =
      `Some experiences only happen inside a window of life — the hike at one age isn't the same hike at another. Money lasts; the chance at the moment doesn't wait for the money.`;
    expect(text).toBe(pinned);
  });

  it('the line makes no reader-specific claim: no numeral, no age/health attribution, no imperative', () => {
    const text = windowLineFor(3)!;
    // The app stores no age or health data (recorded in #518), so the framing
    // is a general truth, never a statement about the reader's window.
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/your age|at your age|\byou are\b|years? .*old/i);
    // The plan's own wording is "buy experiences while you can" — the framing
    // states the window; it must not become a purchase directive.
    expect(text).not.toMatch(
      /\b(buy|book|go|take|treat)\s+(it|yourself|now|them|that)|spend (it|now|today)/i,
    );
    // No read-path claims about the app.
    expect(text).not.toMatch(/Aimplifi|we (count|track|know|see)/i);
  });

  it('the line does not restate the Coast-gated past-enough sentence (#503)', () => {
    const text = windowLineFor(3)!;
    expect(text).not.toMatch(/past enough|turn the dial|compounding is already/i);
  });

  it('test_regression__experiences_window_line_does_not_change_the_dials_reflection_copy', () => {
    // moneyDials and lifeEnergyReflection are read by the production probe and
    // by the Ask what_to_cut answer — the slice adds one leaf, never edits one.
    expect(COACH_COPY.moneyDials(['Travel', 'Dining Out'])).toBe(
      'Your money dials — Travel and Dining Out — are where spending buys you the most life. Spend there proudly; the engine only hunts savings everywhere else.',
    );
    expect(COACH_COPY.lifeEnergyReflection()).toBe(
      "Worth it if it's a money dial or a memory you'll keep — but if it was meant to impress, almost no one notices the thing.",
    );
  });

  it('the demo account has a purchase in the life-energy window the card needs', async () => {
    const d = await getCoachData(DEMO_USER_ID);
    expect(d.lifeEnergy.length).toBeGreaterThan(0);
  });
});
