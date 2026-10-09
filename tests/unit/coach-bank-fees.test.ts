/**
 * DECISIONS #796 /coach wiring (critic cycle 1, P2-5b) — `getCoachData` hands `findBankFees`
 * the coach's own rows (the reader's stored filings, the register's names), the provider's
 * today, the SAME loan-payment exclusion ids and handover days every other coach figure reads,
 * and returns exactly what the engine returned. On the shared demo nothing is filed as a fee.
 */
import { describe, expect, it, vi } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';
import type { BankFeeRowInput, BankFees, findBankFees as FindBankFees } from '@/lib/engine/fi/bank-fees';

const spy = vi.hoisted(() => ({
  calls: [] as Array<{ args: Parameters<typeof FindBankFees>; result: BankFees }>,
}));

vi.mock('@/lib/engine/fi/bank-fees', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/engine/fi/bank-fees')>();
  return {
    ...mod,
    findBankFees: (...args: Parameters<typeof mod.findBankFees>) => {
      const result = mod.findBankFees(...args);
      spy.calls.push({ args, result });
      return result;
    },
  };
});

const { getCoachData } = await import('@/server/coach');
const { getProvider } = await import('@/lib/providers/demo');

describe('#796 — the coach hands the fee engine its own basis', () => {
  it('rows, today, loan-payment exclusions and handover days come from the one snapshot', async () => {
    spy.calls.length = 0;
    const data = await getCoachData(DEMO_USER_ID);
    expect(spy.calls).toHaveLength(1);
    const { args, result } = spy.calls[0];
    const [rows, today, opts] = args;
    const snap = await getProvider().getFinanceSnapshot(DEMO_USER_ID);

    expect(today).toBe(data.today);
    expect(rows).toHaveLength(snap.transactions.length);
    // The reader's stored filing and the bank text, row for row.
    const byId = new Map(snap.transactions.map((t) => [(t as { id: string }).id, t]));
    for (const r of rows as readonly BankFeeRowInput[]) {
      const t = byId.get(r.id);
      expect(t).toBeDefined();
      expect(r.rawDescriptor).toBe(t!.rawDescriptor);
      expect(r.categoryId).toBe((t as { categoryId?: string | null }).categoryId ?? null);
    }
    expect(opts).toBeDefined();
    expect(Object.keys(opts!).sort()).toEqual(['excludedFlowIds', 'handoverKeys']);
    expect(opts!.excludedFlowIds).toEqual(snap.loanPaymentFlowExclusions?.excludeIds);
    expect(opts!.handoverKeys).toEqual(snap.handoverKeys);
    expect(opts!.handoverKeys).toBeInstanceOf(Set);

    // What the page renders is what the engine returned.
    expect(data.bankFees).toBe(result);
    // The shared demo: records reach back past the window, nothing is filed as a fee.
    expect(data.bankFees.recordsFrom).not.toBeNull();
    expect(data.bankFees.recordsFrom! < data.bankFees.from).toBe(true);
    expect(data.bankFees.chargedCents).toBe(0);
    expect(data.bankFees.givenBack).toEqual([]);
  });
});
