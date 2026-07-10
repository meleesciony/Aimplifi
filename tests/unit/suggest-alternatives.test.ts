/**
 * Personalized triage alternatives (TASKS 1.7 / DECISIONS #207).
 * Correction history soft-hints swipe-left categories; empty history is golden.
 */
import { describe, expect, it } from 'vitest';
import {
  suggestAlternatives,
  type TxnInput,
} from '@/lib/engine/categorize/pipeline';
import {
  deriveCorrectionHints,
  type LearnedCorrectionInput,
} from '@/lib/engine/categorize/learn';

let seq = 0;
function corr(
  transactionId: string,
  toCategoryId: string,
  rawDescriptor: string,
  amountCents: number,
  opts: { isUndo?: boolean } = {},
): LearnedCorrectionInput {
  return {
    transactionId,
    toCategoryId,
    rawDescriptor,
    amountCents,
    isUndo: opts.isUndo ?? false,
    seq: seq++,
  };
}

function txn(over: Partial<TxnInput> & { rawDescriptor: string }): TxnInput {
  return { amountCents: -50000, date: '2026-09-01', accountId: 'acct-x', ...over };
}

function alts(t: TxnInput, corrections: LearnedCorrectionInput[] = []) {
  return suggestAlternatives(t, {
    personalized: deriveCorrectionHints(
      { rawDescriptor: t.rawDescriptor, amountCents: t.amountCents },
      corrections,
    ),
  });
}

describe('suggestAlternatives — golden / empty history', () => {
  it('Zelle aggregate with no corrections stays shopping/dining/household', () => {
    expect(alts(txn({ rawDescriptor: 'ZELLE PAYMENT TO J. PARK' }))).toEqual([
      'shopping',
      'dining',
      'household',
    ]);
  });

  it('explicit empty corrections array matches omit', () => {
    const a = suggestAlternatives(txn({ rawDescriptor: 'ZELLE PAYMENT TO J. PARK' }));
    const b = alts(txn({ rawDescriptor: 'ZELLE PAYMENT TO J. PARK' }), []);
    expect(b).toEqual(a);
  });
});

describe('suggestAlternatives — personalized from corrections', () => {
  it('one matching correction surfaces that category early', () => {
    seq = 0;
    const corrections = [corr('a', 'rent', 'ZELLE PAYMENT TO LANDLORD', -200000)];
    const result = alts(
      txn({ rawDescriptor: 'ZELLE PAYMENT TO LANDLORD', amountCents: -200000 }),
      corrections,
    );
    expect(result[0]).toBe('rent');
    expect(result).toHaveLength(3);
    expect(result).toContain('shopping');
  });

  it('does not leak a hint to a different payee (CANARY)', () => {
    seq = 0;
    const corrections = [corr('a', 'rent', 'ZELLE PAYMENT TO LANDLORD', -200000)];
    const result = alts(
      txn({ rawDescriptor: 'ZELLE PAYMENT TO FRIEND', amountCents: -5000 }),
      corrections,
    );
    expect(result).toEqual(['shopping', 'dining', 'household']);
    expect(result).not.toContain('rent');
  });

  it('collapses date-fragmented descriptors for the same counterparty', () => {
    seq = 0;
    const corrections = [corr('a', 'transfer', 'CREDIT CARD PAID 07/01', -10000)];
    const result = alts(
      txn({ rawDescriptor: 'CREDIT CARD PAID 09/01', amountCents: -10000 }),
      corrections,
    );
    expect(result[0]).toBe('transfer');
  });

  it('blocks hints when the same signature has conflicting categories', () => {
    seq = 0;
    const corrections = [
      corr('a', 'utilities', 'ACME BILL PAY', -8000),
      corr('b', 'rent', 'ACME BILL PAY', -8000),
    ];
    const result = alts(txn({ rawDescriptor: 'ACME BILL PAY', amountCents: -8000 }), corrections);
    expect(result).not.toContain('utilities');
    expect(result).not.toContain('rent');
    expect(result).toEqual(['shopping', 'dining', 'household']);
  });

  it('undo removes the hint', () => {
    seq = 0;
    const corrections = [
      corr('a', 'rent', 'ZELLE PAYMENT TO LANDLORD', -200000),
      corr('a', 'rent', 'ZELLE PAYMENT TO LANDLORD', -200000, { isUndo: true }),
    ];
    const result = alts(
      txn({ rawDescriptor: 'ZELLE PAYMENT TO LANDLORD', amountCents: -200000 }),
      corrections,
    );
    expect(result).not.toContain('rent');
  });

  it('sign guard: spend hint never surfaces on an inflow txn', () => {
    seq = 0;
    const corrections = [corr('a', 'dining', 'SOME REFUNDY THING', 5000)];
    const result = alts(
      txn({ rawDescriptor: 'SOME REFUNDY THING', amountCents: 5000 }),
      corrections,
    );
    expect(result).not.toContain('dining');
    expect(result[0]).toBe('income');
  });
});

describe('deriveCorrectionHints', () => {
  it('returns [] for empty history', () => {
    expect(
      deriveCorrectionHints({ rawDescriptor: 'ZELLE PAYMENT TO LANDLORD', amountCents: -1 }, []),
    ).toEqual([]);
  });
});
