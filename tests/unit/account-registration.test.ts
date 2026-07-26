/**
 * Retirement registration (TASKS L.9) — the pure Roth-vs-pretax fact behind the duplicate
 * detector's one cross-provider veto.
 *
 * The locks here are mostly ABSTENTIONS, on purpose: the veto's misfire direction is hiding a
 * real duplicate (the silent double-count #292 removed the mask veto for), so the module must
 * resolve to a registration only on evidence that cannot mean anything else, and
 * `registrationsConflict` may fire only when BOTH sides resolved and disagree.
 */
import { describe, expect, it } from 'vitest';

import { accountRegistration, registrationsConflict } from '@/lib/engine/account/registration';

describe('accountRegistration — resolution', () => {
  it('resolves a Roth from the NAME, whatever case or punctuation the bank used', () => {
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Charles Schwab US Roth Contributory IRA' })).toBe('roth');
    expect(accountRegistration({ type: 'INVESTMENT', name: 'ROTH IRA BROKERAGE ACCOUNT' })).toBe('roth');
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Michael Lee - Roth IRA - ****5351' })).toBe('roth');
  });

  it('resolves a Roth from the provider SUBTYPE alone', () => {
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Brokerage Account', subtype: 'roth' })).toBe('roth');
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Brokerage Account', subtype: 'roth_ira' })).toBe('roth');
  });

  it('a Roth in the NAME wins over an unspecialised `ira` subtype', () => {
    // Plaid's `ira` is the fallback an institution returns for a Roth it did not specialise.
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Roth IRA', subtype: 'ira' })).toBe('roth');
  });

  it('resolves pretax from unambiguous words — traditional / rollover / sep / simple', () => {
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Traditional IRA Brokerage Account' })).toBe('pretax');
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Rollover IRA' })).toBe('pretax');
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Brokerage Account', subtype: 'sep' })).toBe('pretax');
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Brokerage Account', subtype: 'simple' })).toBe('pretax');
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Brokerage Account', subtype: 'sarsep' })).toBe('pretax');
  });

  it('bare `ira` resolves to NOTHING — in a subtype OR a name', () => {
    // It is Plaid's subtype for a traditional IRA AND the unspecialised fallback for a Roth:
    // the one token that would have disqualified the owner's WRONG pair is also the token that
    // would veto his RIGHT one, so it can license nothing.
    expect(accountRegistration({ type: 'INVESTMENT', name: 'IRA Brokerage Account', subtype: 'ira' })).toBeNull();
    expect(accountRegistration({ type: 'INVESTMENT', name: 'IRA Brokerage Account' })).toBeNull();
  });

  it('marketing words in a NAME resolve to nothing — "Simple Brokerage" is not a SIMPLE IRA', () => {
    // `sep`/`simple` are subtype-only evidence by deliberate design: as free words they are
    // marketing, and a mis-resolution would silently hide a real duplicate.
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Simple Brokerage' })).toBeNull();
    expect(accountRegistration({ type: 'INVESTMENT', name: 'SEP IRA Contribution 2026' })).toBeNull();
  });

  it('never resolves off INVESTMENT rows — "Roth" is a surname, "Traditional" a deposit product', () => {
    expect(accountRegistration({ type: 'CHECKING', name: 'Roth Family Checking' })).toBeNull();
    expect(accountRegistration({ type: 'SAVINGS', name: 'Traditional Savings' })).toBeNull();
    expect(accountRegistration({ type: 'CREDIT', name: 'Roth Card', subtype: 'roth' })).toBeNull();
  });

  it('missing subtype / empty name resolve to nothing', () => {
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Brokerage Account' })).toBeNull();
    expect(accountRegistration({ type: 'INVESTMENT', name: '', subtype: null })).toBeNull();
  });

  it('a surname "Roth" on a Traditional IRA resolves to NOTHING — the veto may not hide a real pair', () => {
    // Fresh-context critic P1-1, executed before fixing: "Jill Roth - Traditional IRA" resolved
    // roth, and the veto then hid a REAL same-account pair — the silent-double-count direction
    // #292 removed the mask veto for, and worse than never vetoing (the pair had been disclosed).
    // Bank-composed names embed the HOLDER'S name; a name carrying both token classes is
    // conflicting evidence, which this module reads as an absence.
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Jill Roth - Traditional IRA', subtype: 'ira' })).toBeNull();
    expect(accountRegistration({ type: 'INVESTMENT', name: "Michael Roth's Traditional IRA" })).toBeNull();
    // …and the pair the veto hid now flags normally (locked at the detector level in
    // account-reconciliation-candidates.test.ts).
  });

  it('a name without an IRA context resolves to NOTHING — surname, institution, or annuity marketing', () => {
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Roth Capital Brokerage Account' })).toBeNull();
    expect(accountRegistration({ type: 'INVESTMENT', name: 'TIAA Traditional Annuity' })).toBeNull();
    // Deliberate abstention: a real registration named without "ira" (employer-plan names) is an
    // offerable pair, never a hidden one (the module's RECORDED LIMIT).
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Roth 401k' })).toBeNull();
  });

  it('a specialised employer-plan SUBTYPE still resolves — a subtype never contains a surname', () => {
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Brokerage', subtype: 'roth 401k' })).toBe('roth');
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Brokerage', subtype: 'sep ira' })).toBe('pretax');
  });

  it('subtype evidence wins over a surname name — "Jill Roth" with a roth subtype is still a Roth', () => {
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Jill Roth - Brokerage Account', subtype: 'roth' })).toBe('roth');
  });

  it('a name↔subtype CONTRADICTION resolves to NOTHING (cycle-2 P2-3) — conflicting evidence is an absence', () => {
    // Executed before the fix: {name:'Roth IRA', subtype:'traditional'} resolved pretax and
    // vetoed a REAL Roth↔Roth pair — the silent-double-count direction this module exists to
    // prevent. The same rule as the within-name conflict, one level up.
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Roth IRA', subtype: 'traditional' })).toBeNull();
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Traditional IRA', subtype: 'roth' })).toBeNull();
    // …while agreement resolves, and either source alone still works.
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Roth IRA', subtype: 'roth' })).toBe('roth');
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Traditional IRA', subtype: 'ira' })).toBe('pretax');
  });

  it('the IRA context tokenizes plurals — "Roth and Traditional IRAs" is conflicting, not invisible', () => {
    // "IRAs" tokenizes to `iras` (cycle-2 P2-1); a plural context still counts as a context.
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Roth IRAs Brokerage' })).toBe('roth');
    expect(accountRegistration({ type: 'INVESTMENT', name: 'Roth and Traditional IRAs' })).toBeNull();
  });
});

describe('registrationsConflict — the veto', () => {
  it('fires when one side is a Roth and the other is provably pretax', () => {
    expect(
      registrationsConflict(
        { type: 'INVESTMENT', name: 'Charles Schwab US Roth Contributory IRA' },
        { type: 'INVESTMENT', name: 'Traditional IRA Brokerage Account', subtype: 'ira' },
      ),
    ).toBe(true);
  });

  it('never fires Roth↔Roth, even with an unspecialised subtype on one side', () => {
    expect(
      registrationsConflict(
        { type: 'INVESTMENT', name: 'Roth Contributory IRA' },
        { type: 'INVESTMENT', name: 'Roth IRA Brokerage Account', subtype: 'ira' },
      ),
    ).toBe(false);
  });

  it('never fires when either side is unknown — an absence is not a difference', () => {
    expect(
      registrationsConflict(
        { type: 'INVESTMENT', name: 'Roth Contributory IRA' },
        { type: 'INVESTMENT', name: 'IRA Brokerage Account' },
      ),
    ).toBe(false);
    expect(
      registrationsConflict(
        { type: 'INVESTMENT', name: 'Brokerage Account' },
        { type: 'INVESTMENT', name: 'Other Brokerage' },
      ),
    ).toBe(false);
  });

  it('never fires pretax↔pretax', () => {
    expect(
      registrationsConflict(
        { type: 'INVESTMENT', name: 'Traditional IRA' },
        { type: 'INVESTMENT', name: 'Rollover IRA', subtype: 'ira' },
      ),
    ).toBe(false);
  });

  it('a surname-Roth Traditional IRA against a real Traditional is NOT vetoed — the misfire lock', () => {
    // The detector-level consequence of the resolution lock above: this pair flagged on its own
    // signals before the veto existed, and it must flag again.
    expect(
      registrationsConflict(
        { type: 'INVESTMENT', name: 'Jill Roth - Traditional IRA', subtype: 'ira' },
        { type: 'INVESTMENT', name: 'Traditional IRA - 2291 (2291)' },
      ),
    ).toBe(false);
  });

  it('never fires off INVESTMENT rows even when the words disagree', () => {
    expect(
      registrationsConflict(
        { type: 'CHECKING', name: 'Roth Family Checking' },
        { type: 'CHECKING', name: 'Traditional Checking' },
      ),
    ).toBe(false);
  });
});
