/**
 * Idle-cash /dashboard wiring — same liquid + expense average as runway.
 */
import { describe, expect, it } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { idleCash } from '@/lib/engine/fi/idle-cash';
import { getCoachData } from '@/server/coach';

describe('Idle-cash coach payload', () => {
  it('demo row is the same engine over the runway inputs', async () => {
    const d = await getCoachData(DEMO_USER_ID);
    const recomputed = idleCash({
      liquidCents: d.idleCash.liquidCents,
      monthlyExpenseCents: d.idleCash.monthlyExpenseCents,
      expenseWindowMonths: d.fi.monthlySavingsMonths,
    });
    expect(d.idleCash).toEqual(recomputed);
    expect(d.idleCash.expenseWindowMonths).toBe(d.fi.monthlySavingsMonths);
    expect(d.idleCash.runwayMonths).toBe(d.runwayMonths);

    if (d.idleCash.noExpenses) {
      const empty = COACH_COPY.idleCashEmpty(d.idleCash);
      expect(empty).toMatch(/same expense average the runway figure uses/);
      expect(COACH_COPY.idleCash(d.idleCash)).toBeNull();
      return;
    }
    if (d.idleCash.idle) {
      const idle = COACH_COPY.idleCashIdle(d.idleCash);
      expect(idle).toMatch(/same expense average the runway figure uses/);
      expect(idle).toMatch(/never moves money/);
      expect(idle).not.toMatch(/this card|\bbelow\b/i);
      expect(COACH_COPY.idleCash(d.idleCash)).toBeNull();
      return;
    }
    const sentence = COACH_COPY.idleCash(d.idleCash);
    expect(sentence).not.toBeNull();
    expect(sentence).toMatch(/same expense average the runway figure uses/);
    expect(sentence).toMatch(/never moves money/);
    expect(sentence).not.toMatch(/this card|\bbelow\b/i);
  });
});
