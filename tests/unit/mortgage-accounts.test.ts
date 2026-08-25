/**
 * Demo assembler for the mortgage extra-principal card (DECISIONS #517).
 */
import { describe, expect, it } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { pickMortgageForEarlyPayoff } from '@/lib/engine/debt/mortgage-early-payoff';
import { loadMortgageCandidates } from '@/server/mortgage';

describe('loadMortgageCandidates — demo', () => {
  it('demo seed has no mortgage — honest empty, auto loan is not selected', async () => {
    const rows = await loadMortgageCandidates(DEMO_USER_ID);
    expect(rows).toEqual([]);
    expect(pickMortgageForEarlyPayoff(rows)).toEqual({ kind: 'none' });
    const empty = COACH_COPY.mortgageEarlyPayoffEmpty();
    expect(empty).toMatch(/No mortgage/);
    expect(empty).toMatch(/debt planner/);
    expect(empty).toMatch(/not treated as 0%/);
    expect(empty).not.toMatch(/\bthe tile\b/i);
    expect(empty).not.toMatch(/this card/i);
  });
});
