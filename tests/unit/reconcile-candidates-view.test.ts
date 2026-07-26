/**
 * reconcile-candidates-view.ts locks (TASKS L.9).
 *
 * The label rules are the bug fix: the owner's Continue-an-account card printed each account's
 * number TWICE ("…IRA ...396 (396) (SimpleFIN)", "…****5351 (Plaid ····5351)") over two numbers
 * that were never comparable across providers. Each number must print exactly once, and no rule
 * may ever invent a number or strip one the data only carries once.
 */
import { describe, expect, it } from 'vitest';

import {
  reconcileAmbiguityView,
  reconcileSideLabel,
  RECONCILE_AMBIGUITY_INTRO,
} from '@/components/finance/reconcile-candidates-view';

describe('reconcileSideLabel — the number prints once', () => {
  it('collapses the bank’s own doubled trailing number: "…396 (396)" → "…396"', () => {
    // The exact SimpleFIN Schwab string from the owner's screenshot.
    const label = reconcileSideLabel({
      name: 'Charles Schwab US Roth Contributory IRA ...396 (396)',
      provider: 'simplefin',
      mask: null,
    });
    expect(label.name).toBe('Charles Schwab US Roth Contributory IRA ...396');
    expect(label.qualifier).toBe('SimpleFIN');
  });

  it('collapses the "- 2927 (2927)" shape (U.S. Bank / Truist SimpleFIN names)', () => {
    expect(reconcileSideLabel({ name: 'U.S. Bank Loan - 2927 (2927)', provider: 'simplefin', mask: null }).name).toBe(
      'U.S. Bank Loan - 2927',
    );
    expect(reconcileSideLabel({ name: 'Truist Mortgage 1192 (1192)', provider: 'simplefin', mask: null }).name).toBe(
      'Truist Mortgage 1192',
    );
  });

  it('the qualifier drops a mask the name already shows: "…****5351 (Plaid)", not "····5351" twice', () => {
    const label = reconcileSideLabel({
      name: 'Michael Lee - Roth IRA Brokerage Account - ****5351',
      provider: 'plaid',
      mask: '5351',
    });
    expect(label.name).toBe('Michael Lee - Roth IRA Brokerage Account - ****5351');
    expect(label.qualifier).toBe('Plaid');
  });

  it('keeps the qualifier mask when the name shows a DIFFERENT number — both are evidence', () => {
    // Cross-provider numbers were never comparable (SimpleFIN 396 vs Plaid 5351 can be the SAME
    // real account) — but they are each the bank's own data, printed once each.
    const label = reconcileSideLabel({
      name: 'Charles Schwab US Roth IRA ...396 (396)',
      provider: 'plaid',
      mask: '5351',
    });
    expect(label.name).toBe('Charles Schwab US Roth IRA ...396');
    expect(label.qualifier).toBe('Plaid ····5351');
  });

  it('never collapses a name whose trailing parenthetical is a DIFFERENT number', () => {
    const label = reconcileSideLabel({ name: 'IRA ...396 (5351)', provider: 'simplefin', mask: null });
    expect(label.name).toBe('IRA ...396 (5351)');
  });

  it('never collapses mid-string digits ("401 (401)k" is "401k", not a doubled number)', () => {
    const label = reconcileSideLabel({ name: 'My 401 (401)k Plan', provider: 'manual', mask: null });
    expect(label.name).toBe('My 401 (401)k Plan');
  });

  it('never collapses a one/two-digit run or a parenthetical alone', () => {
    expect(reconcileSideLabel({ name: 'Plan 12 (12)', provider: 'manual', mask: null }).name).toBe('Plan 12 (12)');
    expect(reconcileSideLabel({ name: 'Loan (2927)', provider: 'simplefin', mask: null }).name).toBe('Loan (2927)');
  });

  it('keeps the full qualifier for a plain name with a mask column', () => {
    const label = reconcileSideLabel({ name: 'Chase Total Checking', provider: 'plaid', mask: '1234' });
    expect(label.name).toBe('Chase Total Checking');
    expect(label.qualifier).toBe('Plaid ····1234');
  });

  it('checks ALL embedded digit groups, not the first (critic P2-1: a leading year hid the mask)', () => {
    // "(2021) Roth ****5351" — the first-match parser reads 2021 and stops; the qualifier must
    // still drop the "····5351" the name shows later.
    const label = reconcileSideLabel({ name: '(2021) Roth ****5351', provider: 'plaid', mask: '5351' });
    expect(label.qualifier).toBe('Plaid');
  });

  it('a THREE-digit mask column is recognised too (cycle-2 P2-4: Schwab’s identifier is 3 digits)', () => {
    const label = reconcileSideLabel({
      name: 'Charles Schwab US Roth IRA ...396 (396)',
      provider: 'plaid',
      mask: '396',
    });
    expect(label.name).toBe('Charles Schwab US Roth IRA ...396');
    expect(label.qualifier).toBe('Plaid');
  });

  it('a parenthesized year EQUAL to the mask suppresses the repeat — accepted: the digits still print once', () => {
    // Locked as the accepted failure direction (critic P2-2): the number prints once, merely no
    // longer labelled as the mask. The dangerous direction would be inventing a mask.
    const label = reconcileSideLabel({ name: 'Roth IRA (2021)', provider: 'plaid', mask: '2021' });
    expect(label.qualifier).toBe('Plaid');
  });

  it('a bare-digit year in the name does not strip the qualifier mask (maskFromName is positive-only)', () => {
    const label = reconcileSideLabel({ name: 'Roth IRA 5351', provider: 'plaid', mask: '5351' });
    expect(label.qualifier).toBe('Plaid ····5351');
  });

  it('never edits the name the USER chose (critic P2-3): the collapse is bank-formatting repair only', () => {
    // L.7's point is matching a card entry to a row by his own words — collapsing his nickname
    // on one card broke that match.
    const label = reconcileSideLabel({ name: 'Savings 2024 (2024)', provider: 'plaid', mask: null, userNamed: true });
    expect(label.name).toBe('Savings 2024 (2024)');
    // …but the qualifier rule still applies (the mask is provider data, not his words).
    const masked = reconcileSideLabel({ name: 'My card ****5351', provider: 'plaid', mask: '5351', userNamed: true });
    expect(masked.qualifier).toBe('Plaid');
  });

  it('unknown providers fall back to the raw provider string, matching providerMask', () => {
    expect(reconcileSideLabel({ name: 'X', provider: 'mx', mask: null }).qualifier).toBe('mx');
  });
});

describe('reconcileAmbiguityView — the carried-out conclusion', () => {
  const group = {
    predecessor: { id: 'p', name: 'Old IRA ...396 (396)', provider: 'simplefin', mask: null },
    successors: [
      { id: 's1', name: 'Roth IRA Brokerage - ****5351', provider: 'plaid', mask: '5351' },
      { id: 's2', name: 'Traditional IRA Brokerage - ****1548', provider: 'plaid', mask: '1548' },
    ],
  };

  it('labels every side with the same one-number rules and counts the list it renders', () => {
    const view = reconcileAmbiguityView(group);
    expect(view.predecessor.name).toBe('Old IRA ...396');
    expect(view.successors.map((s) => s.qualifier)).toEqual(['Plaid', 'Plaid']);
    expect(view.matchesSentence).toBe('Looks like 2 of your live accounts:');
  });

  it('the count in the sentence is derived, never passed in (3 successors say 3)', () => {
    const three = reconcileAmbiguityView({
      ...group,
      successors: [...group.successors, { id: 's3', name: 'Rollover IRA - ****9999', provider: 'plaid', mask: '9999' }],
    });
    expect(three.matchesSentence).toBe('Looks like 3 of your live accounts:');
  });

  it('the how-to is plural-safe (critic P1-2): "each pair", and the promise is "when only one remains"', () => {
    const view = reconcileAmbiguityView(group);
    expect(view.howto).toContain('for each pair that isn’t a match');
    expect(view.howto).toContain('when only one possible continuation remains');
    // …and it names the card the Combine option actually lives on, which renders ABOVE.
    expect(view.howto).toContain('above');
  });

  it('byte-identical successor labels get an unforgeable positional suffix (critic P2-4)', () => {
    // Identical nicknames (or the tier-A collision: two genuinely different accounts sharing
    // bank + last-4) must not paint two indistinguishable rows on the card whose job is telling
    // accounts apart — the L.5 disease.
    const colliding = reconcileAmbiguityView({
      predecessor: { id: 'p', name: 'Old Checking', provider: 'simplefin', mask: null },
      successors: [
        { id: 's1', name: 'Joint Checking', provider: 'plaid', mask: '5678' },
        { id: 's2', name: 'Joint Checking', provider: 'plaid', mask: '5678' },
      ],
    });
    expect(colliding.successors[0].qualifier).toBe('Plaid ····5678 · 1');
    expect(colliding.successors[1].qualifier).toBe('Plaid ····5678 · 2');
    // Distinct labels are untouched.
    const distinct = reconcileAmbiguityView(group);
    expect(distinct.successors.map((s) => s.qualifier)).toEqual(['Plaid', 'Plaid']);
  });

  it('the INTRO stays true: it claims the withhold and nothing about balances or counting', () => {
    expect(RECONCILE_AMBIGUITY_INTRO).toContain('not offering to combine');
    // ("accounts" contains both "count" and "counts" as substrings — assert the claims, not letters.)
    expect(RECONCILE_AMBIGUITY_INTRO).not.toMatch(/\$|balance|counts twice|counting/i);
  });
});
