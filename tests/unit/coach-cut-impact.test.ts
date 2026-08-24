/**
 * P.1 /coach radiation — the FI + radar counterfactuals live on CoachData
 * when `opts.cutImpact` is set, and stay off otherwise so dashboard/digest
 * do not pay two extra radar walks.
 *
 * The engines and COACH_COPY are the authors; this file locks the WIRING:
 * the payload is the same walk Ask used to compute locally, the demo FI
 * figures are the standing card's, and the demo radar is the honest null
 * (card-billed opportunities, no checking match).
 */
import { describe, expect, it } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { cutCounterfactual, sumCutMonthlyCents } from '@/lib/engine/fi/counterfactual';
import { formatCents } from '@/lib/money';
import { getCoachData } from '@/server/coach';

describe('P.1 /coach cut-impact payload', () => {
  it('stays off when the flag is omitted — dashboard/digest do not pay the walks', async () => {
    const d = await getCoachData(DEMO_USER_ID);
    expect(d.cutCounterfactual).toBeNull();
    expect(d.radarCounterfactual).toBeNull();
    expect(d.opportunities.length).toBeGreaterThan(0);
  });

  it('FI payload is the same walk as calling cutCounterfactual on the card basis, and the demo moves', async () => {
    const d = await getCoachData(DEMO_USER_ID, { cutImpact: true });
    expect(d.cutCounterfactual).not.toBeNull();
    const cut = sumCutMonthlyCents(d.opportunities);
    expect(d.cutCounterfactual!.cutMonthlyCents).toBe(cut);

    const measured = cutCounterfactual({
      portfolioCents: d.fi.portfolioCents,
      monthlySavingsCents: d.fi.monthlySavingsCents,
      annualExpensesCents: d.fi.annualExpensesCents,
      realReturnBps: d.fi.projectionReturnBps,
      swrBps: d.fi.swrBps,
      cutMonthlyCents: cut,
    });
    expect(d.cutCounterfactual!.result).toEqual(measured);
    expect(measured.baselineFiTargetCents).toBe(d.fi.fiNumberCents);
    expect(measured.baselineMonths).toBe(d.fi.monthsToFI);
    expect(measured.newlyReachable || measured.monthsSooner > 0).toBe(true);
  });

  it('demo FI dollars are the standing cut (per-merchant max) and the target drop', async () => {
    const d = await getCoachData(DEMO_USER_ID, { cutImpact: true });
    expect(formatCents(d.cutCounterfactual!.cutMonthlyCents)).toBe('$78.87');
    expect(formatCents(d.cutCounterfactual!.result.targetDropCents)).toBe('$23,661.00');
    expect(d.opportunities.some((o) => o.isEstimate)).toBe(true);
  });

  it('test_regression__p1_coach_cut_fi_sentence_comes_from_the_one_author', async () => {
    const d = await getCoachData(DEMO_USER_ID, { cutImpact: true });
    const sentence = COACH_COPY.cutCounterfactual(
      new Set(d.opportunities.map((o) => o.merchant)).size,
      d.cutCounterfactual!.cutMonthlyCents,
      d.cutCounterfactual!.result,
      d.opportunities.some((o) => o.isEstimate),
    );
    expect(sentence).not.toBeNull();
    expect(sentence).toContain('about $78.87 a month, part of it estimated');
    expect(sentence).toContain('$23,661.00');
    expect(sentence).toContain('Assumes the cuts stick and the freed money goes to savings');
    expect(sentence).toContain('same return and inflation assumptions as Coach');
    expect(sentence).toContain('Illustration, not advice');
    expect(sentence).not.toMatch(/this card/i);
    expect(sentence).not.toMatch(/\bbelow\b/i);
  });

  it('test_regression__p1_coach_does_not_invent_a_radar_dip_on_the_demo', async () => {
    const d = await getCoachData(DEMO_USER_ID, { cutImpact: true });
    expect(d.radarCounterfactual).not.toBeNull();
    expect(d.radarCounterfactual!.moved).toBe(false);
    expect(COACH_COPY.cutRadarCounterfactual(d.radarCounterfactual!)).toBeNull();
  });
});
