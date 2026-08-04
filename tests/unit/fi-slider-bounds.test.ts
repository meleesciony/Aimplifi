/**
 * W.11 — the FI slider's first paint must not claim the reader just lowered their rate.
 *
 * The component wires these helpers into both `max` and `useState`'s initial value; the
 * caption branch is the same `sliderCaption` expression the card calls. Reverting either
 * half of the fix (hard-coding max=7000, or re-clamping the initial value) fails a test
 * below — mutation-proven by construction of the cases.
 */
import { describe, expect, it } from 'vitest';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { fiSliderInitialBps, fiSliderMaxBps } from '@/lib/engine/fi/fi-slider-bounds';

describe('fiSliderBounds (W.11)', () => {
  it('a saver above 70% can park the thumb on their real pace', () => {
    expect(fiSliderMaxBps(8500)).toBe(8500);
    expect(fiSliderInitialBps(8500)).toBe(8500);
  });

  it('a saver below 70% still gets headroom up to 70%', () => {
    expect(fiSliderMaxBps(3000)).toBe(7000);
    expect(fiSliderInitialBps(3000)).toBe(3000);
  });

  it('exactly 70% keeps the historical ceiling', () => {
    expect(fiSliderMaxBps(7000)).toBe(7000);
    expect(fiSliderInitialBps(7000)).toBe(7000);
  });

  it('a negative pace floors the thumb at 0 without shrinking the ceiling', () => {
    expect(fiSliderMaxBps(-500)).toBe(7000);
    expect(fiSliderInitialBps(-500)).toBe(0);
  });

  it('the old hard clamp is what made the first paint lie (fail-old pin)', () => {
    // Document the pre-W.11 expression so a revert cannot sneak back in as "simpler".
    const oldInitial = Math.min(7000, Math.max(0, 8500));
    expect(oldInitial).toBe(7000);
    const lied = COACH_COPY.sliderCaption(8500, oldInitial, 11, 12, 6);
    expect(lied).toContain('Lowering');
    expect(lied).toContain('85.0%');
    expect(lied).toContain('70.0%');
  });

  it('first paint at the new initial value takes the unchanged branch', () => {
    const fromBps = 8500;
    const toBps = fiSliderInitialBps(fromBps);
    expect(toBps).toBe(fromBps);
    const line = COACH_COPY.sliderCaption(fromBps, toBps, 11, 12, 6);
    expect(line).toContain('current pace');
    expect(line).toContain('85.0%');
    expect(line).not.toContain('Lowering');
    expect(line).not.toContain('Raising');
    // Years arguments must not leak into the unchanged sentence — the old bug mixed a
    // server year (85% pace) with a client year (70% recompute) in one claim.
    expect(line).not.toContain('11');
    expect(line).not.toContain('12');
  });

  it('dragging below the current pace still names the change honestly', () => {
    const fromBps = 8500;
    const line = COACH_COPY.sliderCaption(fromBps, 6000, 11, 14, 6);
    expect(line).toContain('Lowering');
    expect(line).toContain('85.0%');
    expect(line).toContain('60.0%');
    expect(line).toContain('~11 years');
    expect(line).toContain('~14 years');
  });
});
