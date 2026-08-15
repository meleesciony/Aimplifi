/**
 * The combine card's sentences (TASKS L.6 / L.10).
 *
 * These strings sit on top of a money change (a balance stops counting) and a step the app
 * cannot undo (a bank disconnect), so they are locked the same way `plaid-update-copy.ts` is:
 * what they must always say, and what they must never claim.
 */
import { describe, expect, it } from 'vitest';

import {
  accountLabel,
  combineCardTitle,
  combineConfirmPrompt,
  combineDepthNote,
  combineEvidence,
  combineRevokeWarning,
  combineHeading,
  combineOutcome,
  combineReversibilityNote,
  combineStrandedNote,
  combineSuccessFlash,
  connectionLabel,
} from '@/components/finance/combine-connections-copy';

const CARD = { name: 'CREDIT CARD', mask: '0977' };

describe('naming things the reader can see', () => {
  it('labels a connection exactly as the connection list does', () => {
    expect(connectionLabel('Chase', { ordinal: 1, sameBankCount: 4 })).toBe('Chase · connection 1 of 4');
  });

  it('drops the ordinal when there is only one connection to that bank', () => {
    expect(connectionLabel('Chase', { ordinal: 1, sameBankCount: 1 })).toBe('Chase');
    expect(connectionLabel('Chase', undefined)).toBe('Chase');
  });

  it('never renders an empty bank name', () => {
    expect(connectionLabel(null, { ordinal: 2, sameBankCount: 2 })).toBe('this bank · connection 2 of 2');
  });

  it('carries the last-4, because three cards can share a name', () => {
    expect(accountLabel(CARD)).toBe('CREDIT CARD ····0977');
    expect(accountLabel({ name: 'Venture', mask: null })).toBe('Venture');
  });
});

describe('what the card claims', () => {
  it('states the double-count in the places the reader will check', () => {
    const s = combineEvidence([CARD], ['same bank (Chase)', 'same last-4 (0977)']);
    expect(s).toContain('CREDIT CARD ····0977');
    expect(s).toContain('twice');
    expect(s).toContain('same last-4 (0977)');
  });

  it('test_regression__never_claims_nothing_is_lost', () => {
    // Critic P0 (executed): the first version said "Nothing is deleted … each day is counted once
    // from then on" while the combine dropped $890 of charges only the surviving connection had.
    // The sentence must describe the handover, not promise a lossless merge.
    const s = combineOutcome('Chase · connection 1 of 4', 'Chase · connection 4 of 4', [CARD]);
    expect(s).not.toMatch(/nothing is deleted/i);
    expect(s).toContain('started pulling');
    expect(s).toContain('stop being counted twice');
    // Names BOTH connections, so "the one I tapped" is never ambiguous.
    expect(s).toContain('Chase · connection 1 of 4');
    expect(s).toContain('Chase · connection 4 of 4');
  });

  it('test_regression__u13_the_outcome_qualifies_the_counted_once_promise', () => {
    // U.13 released the handover day to both connections, so an UNQUALIFIED "stop being
    // counted twice" over-promises on exactly that day. The sibling test above still
    // requires that phrase (it is true of every other day and the reader needs it), which
    // is precisely why this lock is separate: without it the qualification can be deleted
    // and every existing copy test stays green.
    const s = combineOutcome('Chase · connection 1 of 4', 'Chase · connection 4 of 4', [CARD]);
    expect(s).toContain('Separately, both connections keep any day neither can be shown to have covered in full');
    expect(s).not.toMatch(/changeover/i);
    expect(s).not.toMatch(/last day the old connection covers/i);
    expect(s).not.toMatch(/one day is the exception/i);
    expect(s).not.toMatch(/combined as of/i);
    expect(s).toMatch(/appear twice/i);
  });

  it('test_regression__u13_the_success_flash_does_not_re-promise_counted_once', () => {
    // The LAST sentence the reader sees. It said "N accounts now count once" — a claim about
    // the account, so it inherited the transaction claim U.13 qualified, ten lines from the
    // qualification itself. Balances remain one per date, so it may say that and no more.
    const s = combineSuccessFlash(1, []);
    expect(s).not.toMatch(/counts once|count once/i);
    expect(s).toContain('one balance');
  });

  it('test_regression__the_confirm_step_names_the_irreversible_half', () => {
    const s = combineConfirmPrompt('Chase · connection 1 of 4', 'Chase · connection 4 of 4');
    expect(s).toContain('Disconnect Chase · connection 4 of 4');
    expect(s).toMatch(/can’t be undone/i);
  });

  it('test_regression__no_due_claim_for_a_duplicated_checking_account', () => {
    // Critic P3: "in what's due" is meaningless for a CHECKING duplicate.
    const s = combineEvidence([{ name: 'TOTAL CHECKING', mask: '4411' }], ['same last-4 (4411)']);
    expect(s).not.toMatch(/what’s due|what's due/);
    expect(s).toContain('adds your accounts up');
  });

  it('discloses a revoke the bank never confirmed', () => {
    expect(combineRevokeWarning('Chase · connection 4 of 4')).toMatch(/didn’t confirm it revoked access/);
  });

  it('titles the card without naming a bank, since two proposals can be at two banks', () => {
    expect(combineCardTitle(2)).not.toContain('Chase');
    expect(combineHeading('Chase')).toContain('Chase');
  });

  it('separates the reversible half from the irreversible half, and names which is which', () => {
    const s = combineReversibilityNote('Chase · connection 4 of 4');
    expect(s).toContain('undo the combine');
    expect(s).toMatch(/not something this page can undo/i);
    expect(s).toContain('Chase · connection 4 of 4');
  });

  it('never claims a total was corrected or an amount was recalculated', () => {
    const all = [
      combineHeading('Chase'),
      combineEvidence([CARD], ['same last-4 (0977)']),
      combineOutcome('A', 'B', [CARD]),
      combineReversibilityNote('B'),
      combineStrandedNote('B', ['CHECKING']),
      combineSuccessFlash(1, []),
      combineSuccessFlash(0, ['x']),
      combineSuccessFlash(2, ['x']),
    ].join(' ');
    expect(all).not.toMatch(/corrected|recalculat|adjusted|fixed your|we removed/i);
  });

  it('explains why only one direction is offered instead of silently offering one', () => {
    const s = combineStrandedNote('Chase · connection 4 of 4', ['CHECKING ····1111']);
    expect(s).toContain('CHECKING ····1111');
    expect(s).toMatch(/isn’t offered/);
  });
});

describe('the flash after the action', () => {
  it('reports a clean run as clean', () => {
    // The property is "a clean run reads as clean, singular and plural" — U.13 changed the
    // claim it makes (balances, not "counts once"), not the property under test.
    expect(combineSuccessFlash(1, [])).toContain('now has one balance instead of two');
    expect(combineSuccessFlash(2, [])).toContain('now have one balance instead of two');
  });

  it('never reports a partial run as a clean one, and points at the way to finish', () => {
    const s = combineSuccessFlash(1, ['CREDIT CARD ····0977: nope']);
    expect(s).toMatch(/Partly done/);
    expect(s).toContain('didn’t link');
    expect(s).toContain('Combine');
  });

  it('never claims anything counts once when nothing linked', () => {
    const s = combineSuccessFlash(0, ['CREDIT CARD ····0977: nope']);
    expect(s).not.toMatch(/counts? once/);
    expect(s).toContain('nothing has been linked');
    // Still discloses the half that DID happen — the bank is disconnected either way.
    expect(s).toContain('disconnected');
  });
});

describe('combineDepthNote — what each side has actually pulled, beside the irreversible button (H.6c critic P1)', () => {
  const KEEP = 'Chase · connection 1 of 2';
  const DROP = 'Chase · connection 2 of 2';

  it('warns when the choice would disconnect the side holding the older history, naming both dates', () => {
    const note = combineDepthNote(KEEP, DROP, '2026-05-09', '2024-08-08');
    expect(note).toContain(DROP);
    expect(note).toContain('Thu, Aug 8, 2024');
    expect(note).toContain('Sat, May 9, 2026');
    expect(note).toContain('older history');
    expect(note).toContain('pick the other option');
  });

  it('warns when the dropped side has stored NOTHING yet — the mid-pull deepen shape', () => {
    const note = combineDepthNote(KEEP, DROP, '2026-05-09', null);
    expect(note).toContain(DROP);
    expect(note).toContain('hasn’t stored any transactions yet');
    expect(note).toContain('wait');
  });

  it('says nothing when the choice drops the shallower side — the safe direction needs no caveat', () => {
    expect(combineDepthNote(KEEP, DROP, '2024-08-08', '2026-05-09')).toBeNull();
    expect(combineDepthNote(KEEP, DROP, '2026-05-09', '2026-05-09')).toBeNull();
  });

  it('says nothing when neither side has stored anything — there is no depth claim to make', () => {
    expect(combineDepthNote(KEEP, DROP, null, null)).toBeNull();
  });

  it('warns when the dropped side is the ONLY side with history', () => {
    const note = combineDepthNote(KEEP, DROP, null, '2024-08-08');
    expect(note).toContain('hasn’t stored any yet');
    expect(note).toContain('older history');
  });
});
