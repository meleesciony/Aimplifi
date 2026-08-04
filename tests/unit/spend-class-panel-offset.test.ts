/**
 * The "why is there no dial" panel stays on screen (2026-08-03).
 *
 * Measured failing twice before this existed, both times only visible in a
 * screenshot: left-anchored, the panel ran off the right edge of the 380px
 * register; flipped to right-anchored, it ran off the LEFT edge by 55px,
 * because the panel is wider than the space either side of a chip near an edge.
 * Anchoring cannot solve it; clamping can. This is the arithmetic, pinned here
 * so the next change to the panel's width cannot quietly push it off-screen
 * again — an explanation the reader cannot read is the bug this whole change
 * set out to fix.
 */
import { describe, expect, it } from 'vitest';
import { panelOffset } from '@/components/finance/spend-class-badge';

/** Absolute viewport coordinates of the panel, the way the browser lays it out. */
function placed(chipLeft: number, viewportWidth: number) {
  const { left, width } = panelOffset(chipLeft, viewportWidth);
  return { start: chipLeft + left, end: chipLeft + left + width, width };
}

describe('panelOffset', () => {
  it('leaves a left-hand chip exactly where it is', () => {
    // Room to spare: no correction, so the panel reads as attached to its chip.
    expect(panelOffset(20, 380).left).toBe(0);
    expect(panelOffset(20, 380).width).toBe(240);
  });

  it('test_regression__never_overflows_either_edge_of_the_register', () => {
    // Every chip position across the mobile-380 viewport the e2e runs at.
    for (let chipLeft = 0; chipLeft <= 380; chipLeft += 5) {
      const { start, end } = placed(chipLeft, 380);
      expect(start, `chip at ${chipLeft}px`).toBeGreaterThanOrEqual(0);
      expect(end, `chip at ${chipLeft}px`).toBeLessThanOrEqual(380);
    }
  });

  it('test_regression__a_chip_near_the_right_edge_pulls_the_panel_back_in', () => {
    // The exact failure: right-anchoring put this panel's left edge at -54.65.
    const { start, end } = placed(330, 380);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeLessThanOrEqual(380);
  });

  it('shrinks rather than overflowing when the screen is narrower than the panel', () => {
    const { start, end, width } = placed(10, 200);
    expect(width).toBe(200 - 16);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeLessThanOrEqual(200);
  });

  it('keeps its full width on a desktop viewport', () => {
    expect(placed(600, 1440).width).toBe(240);
    expect(panelOffset(600, 1440).left).toBe(0);
  });
});
