/**
 * The account identity ladder (docs/ACCOUNT_IDENTITY_ARCHITECTURE.md §5; TASKS L.10).
 *
 * The ladder exists to authorise an ACTION, so what it REFUSES to prove matters more than what
 * it proves — every `unproven` below is a pair the app must leave to the advisory layer rather
 * than offer to merge (docs/lessons/context-carrying-features-must-abstain.md). The abstention
 * and veto cases are the majority on purpose.
 *
 * The two lead scenarios are the owner's own, verified from his 2026-07-24 screenshots:
 *   - Chase `CREDIT CARD ····0977` arriving through two Plaid connections → PROVEN SAME.
 *   - his and his wife's cards on one issuer, different last-4 → PROVEN DIFFERENT, forever.
 */
import { describe, expect, it } from 'vitest';

import {
  compareAccountIdentity,
  isProvenSameAccount,
  type IdentityAccount,
} from '@/lib/engine/account/identity';

function acct(p: Partial<IdentityAccount> = {}): IdentityAccount {
  return {
    provider: 'plaid',
    institutionId: 'ins_56',
    institutionName: 'Chase',
    mask: '0977',
    type: 'CREDIT',
    subtype: 'credit card',
    currency: 'USD',
    persistentAccountId: null,
    connectionId: null,
    ...p,
  };
}

describe('identity ladder — proven same', () => {
  it('proves the owner’s Chase ····0977 pulled through two connections is one account', () => {
    const r = compareAccountIdentity(acct(), acct());
    expect(r.verdict).toBe('same');
    expect(r.tier).toBe('A');
    expect(r.reasons).toContain('same last-4 (0977)');
    expect(isProvenSameAccount(acct(), acct())).toBe(true);
  });

  it('proves it on Plaid’s persistent id even when the bank renamed the row', () => {
    const r = compareAccountIdentity(
      acct({ persistentAccountId: 'pai-1', mask: null }),
      acct({ persistentAccountId: 'pai-1', mask: null }),
    );
    expect(r.verdict).toBe('same');
    expect(r.tier).toBe('P');
  });

  it('does not need the institution id when both connections name the same bank', () => {
    const r = compareAccountIdentity(
      acct({ institutionId: null, institutionName: 'Chase' }),
      acct({ institutionId: null, institutionName: 'chase ' }),
    );
    expect(r.verdict).toBe('same');
  });

  it('ignores the account NAME entirely — same card, two different feed names', () => {
    expect(compareAccountIdentity(acct(), acct()).verdict).toBe('same');
    // (the ladder's input type carries no name and no balance at all — a structural guarantee)
  });

  it('a missing subtype on one side does not block the last-4 proof', () => {
    const r = compareAccountIdentity(acct({ subtype: null }), acct());
    expect(r.verdict).toBe('same');
  });

  it('treats a null currency as USD rather than as a difference', () => {
    expect(compareAccountIdentity(acct({ currency: null }), acct({ currency: 'usd' })).verdict).toBe('same');
  });
});

describe('identity ladder — proven different (the vetoes)', () => {
  it('vetoes a differing last-4 at one bank: his card and his wife’s stay separate', () => {
    const r = compareAccountIdentity(acct({ mask: '0977' }), acct({ mask: '4927' }));
    expect(r.verdict).toBe('different');
    expect(r.reasons.join(' ')).toContain('different last-4');
  });

  it('vetoes a Roth against a Traditional IRA (the L.9 pair)', () => {
    const r = compareAccountIdentity(
      acct({ type: 'INVESTMENT', subtype: 'roth', mask: null }),
      acct({ type: 'INVESTMENT', subtype: 'traditional', mask: null }),
    );
    expect(r.verdict).toBe('different');
  });

  it('vetoes different account kinds', () => {
    expect(compareAccountIdentity(acct({ type: 'CREDIT' }), acct({ type: 'CHECKING' })).verdict).toBe('different');
  });

  it('vetoes different currencies', () => {
    expect(compareAccountIdentity(acct({ currency: 'USD' }), acct({ currency: 'EUR' })).verdict).toBe('different');
  });

  it('vetoes different banks even when everything else matches', () => {
    expect(compareAccountIdentity(acct({ institutionId: 'ins_1' }), acct({ institutionId: 'ins_2' })).verdict).toBe(
      'different',
    );
  });

  it('vetoes two rows returned by ONE connection — the bank lists them separately', () => {
    // Without this the ladder would "prove" two sibling cards sharing a last-4 shape are one
    // account, and a caller written later would inherit the bug.
    const r = compareAccountIdentity(acct({ connectionId: 'item-1' }), acct({ connectionId: 'item-1' }));
    expect(r.verdict).toBe('different');
  });

  it('still compares rows from two DIFFERENT connections', () => {
    expect(
      compareAccountIdentity(acct({ connectionId: 'item-1' }), acct({ connectionId: 'item-2' })).verdict,
    ).toBe('same');
  });

  it('vetoes on the bank’s own persistent id, overriding an equal last-4', () => {
    const r = compareAccountIdentity(
      acct({ persistentAccountId: 'pai-1' }),
      acct({ persistentAccountId: 'pai-2' }),
    );
    expect(r.verdict).toBe('different');
  });
});

describe('identity ladder — abstains (falls through to the advisory layer)', () => {
  it('abstains cross-provider, however identical: a last-4 is not comparable across feeds (L.9)', () => {
    const r = compareAccountIdentity(acct({ provider: 'simplefin' }), acct({ provider: 'plaid' }));
    expect(r.verdict).toBe('unproven');
  });

  it('abstains on demo and manual rows (D8)', () => {
    expect(compareAccountIdentity(acct({ provider: 'demo' }), acct({ provider: 'demo' })).verdict).toBe('unproven');
    expect(compareAccountIdentity(acct({ provider: 'manual' }), acct({ provider: 'manual' })).verdict).toBe('unproven');
  });

  it('abstains when either side has no last-4 — an absence is not evidence', () => {
    expect(compareAccountIdentity(acct({ mask: null }), acct()).verdict).toBe('unproven');
    expect(compareAccountIdentity(acct({ mask: null }), acct({ mask: null })).verdict).toBe('unproven');
    expect(compareAccountIdentity(acct({ mask: '  ' }), acct()).verdict).toBe('unproven');
  });

  it('test_regression__abstains_when_only_one_side_has_a_bank_id', () => {
    // Critic P2 (executed): falling back to the human NAME when one side HAS an `ins_*` id let a
    // row that had been identified match one that had not, on a string two different banks share
    // ("Citizens Bank", "First National Bank"). Once inside one "institution" the only remaining
    // guard is a 4-digit number.
    const r = compareAccountIdentity(
      acct({ institutionId: 'ins_111', institutionName: 'Citizens Bank' }),
      acct({ institutionId: null, institutionName: 'Citizens Bank' }),
    );
    expect(r.verdict).toBe('unproven');
  });

  it('test_regression__never_proves_a_retirement_account_on_a_missing_subtype', () => {
    // A Roth and a Traditional are both INVESTMENT and the subtype is the ONLY field that
    // separates them (L.9) — and it is stamped on a best-effort call that a broken connection is
    // exactly the case to fail. So an unknown subtype is disqualifying HERE, not merely silent.
    const r = compareAccountIdentity(
      acct({ type: 'INVESTMENT', subtype: null, mask: '5351' }),
      acct({ type: 'INVESTMENT', subtype: null, mask: '5351' }),
    );
    expect(r.verdict).toBe('unproven');
    // With both subtypes present it proves normally.
    expect(
      compareAccountIdentity(
        acct({ type: 'INVESTMENT', subtype: 'roth', mask: '5351' }),
        acct({ type: 'INVESTMENT', subtype: 'roth', mask: '5351' }),
      ).verdict,
    ).toBe('same');
  });

  it('abstains when neither connection’s bank is known', () => {
    const blind = { institutionId: null, institutionName: null };
    expect(compareAccountIdentity(acct(blind), acct(blind)).verdict).toBe('unproven');
  });

  it('abstains when one side’s bank is unknown — never guesses it is the same bank', () => {
    expect(
      compareAccountIdentity(acct({ institutionId: null, institutionName: null }), acct()).verdict,
    ).toBe('unproven');
  });

  it('abstains on contradictory evidence: same persistent id, different last-4', () => {
    const r = compareAccountIdentity(
      acct({ persistentAccountId: 'pai-1', mask: '0977' }),
      acct({ persistentAccountId: 'pai-1', mask: '4927' }),
    );
    expect(r.verdict).toBe('unproven');
  });

  it('is symmetric — the answer never depends on which row is asked about first', () => {
    const pairs: [IdentityAccount, IdentityAccount][] = [
      [acct(), acct({ mask: '4927' })],
      [acct({ mask: null }), acct()],
      [acct({ persistentAccountId: 'pai-1' }), acct({ persistentAccountId: 'pai-1', mask: '4927' })],
      [acct({ subtype: null }), acct({ subtype: 'roth' })],
    ];
    for (const [x, y] of pairs) {
      expect(compareAccountIdentity(x, y).verdict).toBe(compareAccountIdentity(y, x).verdict);
    }
  });
});
