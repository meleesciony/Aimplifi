/**
 * W.6(d) /coach wiring — drawdown lives on `CoachData.fi.drawdown` and is the
 * same walk as hand-calling `drawdownCounterfactual` on the card basis.
 * COACH_COPY is the one author of the sentence.
 */
import { describe, expect, it } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { drawdownCounterfactual } from '@/lib/engine/fi/drawdown';
import { cents } from '@/lib/money';
import { getCoachData } from '@/server/coach';

describe('W.6(d) /coach drawdown payload', () => {
  it('payload equals hand-calling drawdownCounterfactual on the FI card basis', async () => {
    const d = await getCoachData(DEMO_USER_ID);
    const measured = drawdownCounterfactual({
      portfolioCents: d.fi.portfolioCents,
      monthlySavingsCents: d.fi.monthlySavingsCents,
      realReturnBps: d.fi.projectionReturnBps,
      fiTargetCents: d.fi.fiNumberCents,
    });
    expect(d.fi.drawdown).toEqual(measured);
    expect(d.fi.drawdown.baselineMonths).toBe(d.fi.monthsToFI);
    expect(d.fi.portfolioCents).toBe(14_200_000);
  });

  it('demo moves — disclosure sentence is present and one-authored', async () => {
    const d = await getCoachData(DEMO_USER_ID);
    expect(d.fi.drawdown.monthsLater).toBeGreaterThan(0);
    const sentence = COACH_COPY.drawdownCounterfactual(d.fi.drawdown);
    expect(sentence).not.toBeNull();
    expect(sentence).toContain('30% drop');
    expect(sentence).toContain('push the FI date about');
    expect(sentence).toContain('later');
    expect(sentence).toContain('Same savings rate and same return and inflation assumptions as Coach');
    expect(sentence).toContain('Illustration, not advice');
    expect(sentence).not.toMatch(/this card/i);
    expect(sentence).not.toMatch(/\bbelow\b/i);
  });

  it('honest null when the shock does not move the date', () => {
    expect(
      COACH_COPY.drawdownCounterfactual({
        shockBps: 3000,
        baselineMonths: 120,
        shockedMonths: 120,
        shockedPortfolioCents: cents(0),
        monthsLater: 0,
        newlyUnreachable: false,
      }),
    ).toBeNull();
  });
});
