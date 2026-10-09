/**
 * DECISIONS #796 /coach wiring (critic cycle 1 P2-5b; cycle 2 P2-4) — `getCoachData` hands
 * `findBankFees` the coach's own rows (the reader's stored filings and bank text), the
 * provider's today, and the SAME loan-payment exclusion ids, handover days and reconnection
 * links the snapshot carries, and renders exactly what the engine returned.
 *
 * Cycle 2 found the first version vacuous: the demo snapshot has no loan-payment exclusions
 * and no handover days, so passing `undefined` and an empty set satisfied it. The snapshot is
 * now wrapped to carry a sentinel of each, and the engine's options must hold them.
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
const { DemoProvider } = await import('@/lib/providers/demo');
const { handoverKey } = await import('@/lib/engine/account/reconcile-boundary');
const { bankFeesLead } = await import('@/lib/engine/fi/bank-fees-copy');

const SENTINEL_EXCLUDED_ID = 'sentinel-loan-payment-row';
const SENTINEL_HANDOVER = handoverKey('sentinel-account', '2026-01-15');
const SENTINEL_LINK: [string, string] = ['sentinel-old-account', 'sentinel-new-account'];

describe('#796 — the coach hands the fee engine its own basis', () => {
  it('rows, today, loan-payment exclusions and handover days come from the one snapshot', async () => {
    const real = DemoProvider.prototype.getFinanceSnapshot;
    const snapshots: Awaited<ReturnType<typeof real>>[] = [];
    const wrap = vi.spyOn(DemoProvider.prototype, 'getFinanceSnapshot').mockImplementation(async function (
      this: InstanceType<typeof DemoProvider>,
      userId: string,
    ) {
      const snap = await real.call(this, userId);
      const wrapped = {
        ...snap,
        loanPaymentFlowExclusions: {
          excludeIds: new Set([...(snap.loanPaymentFlowExclusions?.excludeIds ?? []), SENTINEL_EXCLUDED_ID]),
          excluded: snap.loanPaymentFlowExclusions?.excluded ?? [],
        },
        handoverKeys: new Set([...snap.handoverKeys, SENTINEL_HANDOVER]),
        terminalOf: new Map([...(snap.terminalOf ?? []), SENTINEL_LINK]),
      };
      snapshots.push(wrapped);
      return wrapped;
    });
    try {
      spy.calls.length = 0;
      const data = await getCoachData(DEMO_USER_ID);
      expect(spy.calls).toHaveLength(1);
      const { args, result } = spy.calls[0];
      const [rows, today, opts] = args;
      const snap = snapshots[0];

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
      // The snapshot's own sets, sentinels and all — never undefined, never a fresh empty set.
      expect(opts?.excludedFlowIds?.has(SENTINEL_EXCLUDED_ID)).toBe(true);
      expect(opts?.handoverKeys?.has(SENTINEL_HANDOVER)).toBe(true);
      expect(opts?.excludedFlowIds).toBe(snap.loanPaymentFlowExclusions?.excludeIds);
      expect(opts?.handoverKeys).toBe(snap.handoverKeys);
      expect(opts?.terminalOf?.get(SENTINEL_LINK[0])).toBe(SENTINEL_LINK[1]);
      expect(opts?.terminalOf).toBe(snap.terminalOf);

      // What the page renders is what the engine returned.
      expect(data.bankFees).toBe(result);
      // The shared demo: nothing is filed as a fee.
      expect(data.bankFees.records.from).not.toBeNull();
      expect(data.bankFees.chargedCents).toBe(0);
      expect(data.bankFees.givenBack).toEqual([]);
      expect(data.bankFees.uncounted).toEqual([]);
      // Every demo account's records reach back past the window, so the zero is "in the last 12 months".
      expect(data.bankFees.records.accountsStartingInWindow).toBe(0);
      expect(bankFeesLead(data.bankFees)).toBe('No bank or card fees counted in the last 12 months.');
    } finally {
      wrap.mockRestore();
    }
  });
});
