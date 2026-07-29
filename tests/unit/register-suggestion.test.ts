/**
 * The register's suggestion ladder (TASKS O.9d / DECISIONS #333) — pure engine.
 *
 * Parity with the inbox is the invariant under test: same precedence
 * (pipeline → provider → history proposal), same gates (unfiled rows only,
 * transfers skipped unless review-pinned). The ABSTENTIONS are the majority
 * here on purpose (docs/lessons/context-carrying-features-must-abstain.md):
 * every wrong chip is a mis-file one tap away.
 */
import { describe, expect, it } from 'vitest';
import type { LearnedCorrectionInput } from '@/lib/engine/categorize/learn';
import {
  type RegisterSuggestionInput,
  registerSuggestionFor,
} from '@/lib/engine/categorize/register-suggestion';

/** Two prior filings of the same landlord Venmo — earns a 'payee' proposal. */
const VENMO_CORRECTIONS: LearnedCorrectionInput[] = [
  {
    transactionId: 't1',
    seq: 1,
    isUndo: false,
    toCategoryId: 'rent',
    rawDescriptor: 'VENMO PAYMENT 111111 J SMITH',
    amountCents: -145_000,
  },
  {
    transactionId: 't2',
    seq: 2,
    isUndo: false,
    toCategoryId: 'rent',
    rawDescriptor: 'VENMO PAYMENT 222222 J SMITH',
    amountCents: -145_000,
  },
];

function input(overrides: Partial<RegisterSuggestionInput> = {}): RegisterSuggestionInput {
  return {
    currentCategoryId: 'uncategorized',
    isTransfer: false,
    reviewPinned: false,
    pipelineCategoryId: 'uncategorized',
    providerCategoryId: null,
    txn: { rawDescriptor: 'VENMO PAYMENT 333333 J SMITH', amountCents: -145_000 },
    ...overrides,
  };
}

describe('registerSuggestionFor — gates (a filed row is never second-guessed)', () => {
  it('abstains for a row that already has a category, even with every rung available', () => {
    expect(
      registerSuggestionFor(
        input({
          currentCategoryId: 'dining',
          pipelineCategoryId: 'groceries',
          providerCategoryId: 'shopping',
        }),
        VENMO_CORRECTIONS,
      ),
    ).toBeNull();
  });

  it('abstains for a transfer (inbox #165 parity)', () => {
    expect(
      registerSuggestionFor(input({ isTransfer: true, pipelineCategoryId: 'dining' }), []),
    ).toBeNull();
  });

  it('a review-pinned transfer still gets asked (inbox #148 parity)', () => {
    expect(
      registerSuggestionFor(
        input({ isTransfer: true, reviewPinned: true, pipelineCategoryId: 'dining' }),
        [],
      ),
    ).toEqual({ kind: 'ruleset', categoryId: 'dining', proposal: null });
  });

  it('abstains entirely when no rung produces anything', () => {
    expect(
      registerSuggestionFor(
        input({ txn: { rawDescriptor: 'SOME NEW SHOP 44', amountCents: -1_299 } }),
        [],
      ),
    ).toBeNull();
  });
});

describe('registerSuggestionFor — precedence (the inbox ladder, exactly)', () => {
  it('the pipeline verdict outranks the provider guess and the history proposal', () => {
    const s = registerSuggestionFor(
      input({ pipelineCategoryId: 'groceries', providerCategoryId: 'shopping' }),
      VENMO_CORRECTIONS,
    );
    expect(s).toEqual({ kind: 'ruleset', categoryId: 'groceries', proposal: null });
  });

  it('the provider guess outranks the history proposal on an ORDINARY merchant (inbox gate: proposals only when both are empty)', () => {
    // Two prior filings of the same pizzeria — self-validate that the history
    // rung CAN speak for this row before asserting the provider outranks it.
    const pizzaHistory: LearnedCorrectionInput[] = [
      { transactionId: 'p1', seq: 1, isUndo: false, toCategoryId: 'dining', rawDescriptor: 'JOES PIZZA #221 ATLANTA GA', amountCents: -3_200 },
      { transactionId: 'p2', seq: 2, isUndo: false, toCategoryId: 'dining', rawDescriptor: 'JOES PIZZA #443 ATLANTA GA', amountCents: -2_850 },
    ];
    const pizzaRow = input({ txn: { rawDescriptor: 'JOES PIZZA #512 ATLANTA GA', amountCents: -3_000 } });
    expect(registerSuggestionFor(pizzaRow, pizzaHistory)?.kind).toBe('history'); // fixture proves itself
    const s = registerSuggestionFor({ ...pizzaRow, providerCategoryId: 'shopping' }, pizzaHistory);
    expect(s).toEqual({ kind: 'provider', categoryId: 'shopping', proposal: null });
  });

  it("an AGGREGATE row never shows Plaid's guess — the channel says nothing about the payee (inbox group.ts parity, critic F1)", () => {
    // With history: the payee-specific proposal speaks INSTEAD of the provider,
    // so the register can never one-tap a different category than the inbox
    // proposes for the same Venmo row.
    const withHistory = registerSuggestionFor(
      input({ providerCategoryId: 'shopping' }),
      VENMO_CORRECTIONS,
    );
    expect(withHistory?.kind).toBe('history');
    expect(withHistory?.categoryId).toBe('rent');
    // Without history: the row stays bare rather than wearing the channel guess.
    expect(registerSuggestionFor(input({ providerCategoryId: 'shopping' }), [])).toBeNull();
  });

  it('the history proposal is the last resort, and carries its evidence', () => {
    const s = registerSuggestionFor(input(), VENMO_CORRECTIONS);
    expect(s?.kind).toBe('history');
    expect(s?.categoryId).toBe('rent');
    // The proposal object travels so the caller can render the evidence
    // sentence — a proposal that cannot be checked is just a guess.
    expect(s?.proposal?.basis).toBe('payee');
    expect(s?.proposal?.supportCount).toBe(2);
  });
});
