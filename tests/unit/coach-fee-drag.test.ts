/**
 * P1.5 /coach wiring — fee-drag is computed from the same portfolio +
 * nominal dial `getCoachData` already carries. COACH_COPY is the one author.
 */
import { describe, expect, it } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { feeDrag } from '@/lib/engine/fi/fee-drag';
import { opportunityValueTodayCents } from '@/lib/engine/fi/fi';
import { cents, formatCents } from '@/lib/money';
import { getCoachData } from '@/server/coach';

const DEFAULT_OWNER = { returnIsDefault: true, inflationIsDefault: true };

describe('P1.5 /coach fee-drag payload', () => {
  it('demo $142k at the card dials is one-authored in today\'s money', async () => {
    const d = await getCoachData(DEMO_USER_ID);
    expect(d.fi.portfolioCents).toBe(14_200_000);
    expect(d.fi.feeDrag).not.toBeNull();
    expect(d.fi.feeDrag!.monthlyLeakCents).toBe(11_833);
    expect(d.fi.feeDrag!.costTodayCents).toBe(
      opportunityValueTodayCents(cents(11_833), 360, d.fi.expectedReturnBps, d.fi.inflationBps),
    );
    const recomputed = feeDrag({
      portfolioCents: d.fi.portfolioCents,
      nominalReturnBps: d.fi.expectedReturnBps,
      inflationBps: d.fi.inflationBps,
    });
    expect(recomputed).toEqual(d.fi.feeDrag);

    const owner = {
      returnIsDefault: d.fi.returnIsDefault,
      inflationIsDefault: d.fi.inflationIsDefault,
    };
    const sentence = COACH_COPY.feeDrag(d.fi.feeDrag!, owner);
    expect(sentence).not.toBeNull();
    expect(sentence).toContain('$142,000.00');
    expect(d.fi.feeDrag!.costTodayCents).toBe(6_882_218);
    expect(sentence).toContain('$68,822.18');
    expect(sentence).toContain(formatCents(d.fi.feeDrag!.costTodayCents));
    expect(sentence).toContain('$118.33 a month');
    expect(sentence).toContain("today's money");
    expect(sentence).toContain('grown at our default 7.00% return assumption');
    expect(sentence).toContain('our default 2.50% inflation assumption taken off');
    expect(sentence).not.toContain('assumptions working');
    expect(sentence).toContain('not a fee we can see');
    expect(sentence).toContain('not a fee that grows with the pile');
    expect(sentence).toContain('Illustration, not advice');
    expect(sentence).not.toMatch(/this card/i);
    expect(sentence).not.toMatch(/\bbelow\b/i);
    expect(sentence).not.toMatch(/\b(VTSAX|VTI|VOO|SPY|AAPL)\b/);
  });

  it('honest null when the leak costs nothing', () => {
    expect(
      COACH_COPY.feeDrag(
        {
          portfolioCents: cents(10_000_000),
          monthlyLeakCents: cents(8_333),
          feeBps: 100,
          months: 360,
          nominalReturnBps: 700,
          inflationBps: 250,
          costTodayCents: cents(0),
          costNominalCents: cents(0),
        },
        DEFAULT_OWNER,
      ),
    ).toBeNull();
  });

  it('ladder does not claim a match or a fund', () => {
    const ladder = COACH_COPY.investingLadder();
    expect(ladder).toContain('lens, not a rule');
    expect(ladder).toContain('when you have one');
    expect(ladder).toContain("we don't yet know whether you have a match");
    expect(ladder).toContain('never recommend specific funds');
    expect(ladder).not.toMatch(/this card/i);
    expect(ladder).not.toMatch(/\bbelow\b/i);
    expect(ladder).not.toMatch(/\b(VTSAX|VTI|VOO|SPY|AAPL)\b/);
  });
});
