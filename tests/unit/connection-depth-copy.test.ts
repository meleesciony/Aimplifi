/**
 * TASKS H.1(b) — the SENTENCES, locked in a plain unit test with no jsdom and no mocks.
 *
 * This file exists because of an executed critic finding: while the copy lived inside
 * `plaid-connections.tsx`, importing it under vitest failed outright (`Cannot find module
 * 'next/server'`, via next-auth) unless the whole server-action module was stubbed. So the
 * ~6,000-test unit gate stayed green for ANY wrong sentence and only `VERIFY_E2E=1` could
 * catch one. Moving the copy to `src/lib/engine/account/connection-depth-copy.ts` — the
 * `continued-accounts-view.ts` / `combine-connections-copy.ts` precedent — is what makes
 * these assertions possible at all.
 *
 * Each case names the claim the sentence makes, because each of these was WRONG in an
 * earlier cut and a critic proved it by execution.
 */
import { describe, expect, it } from 'vitest';

import { connectionDepthSentence } from '@/lib/engine/account/connection-depth-copy';

describe('connectionDepthSentence', () => {
  it('reaches: uses the REGISTER\'S own phrasing, and keeps the year', () => {
    // Two lines making the same kind of claim must not read as two different claims:
    // /transactions prints "History available from Sun, Aug 11, 2024." for the global floor.
    expect(connectionDepthSentence({ state: 'reaches', earliest: '2024-08-11' })).toBe(
      'History available from Sun, Aug 11, 2024.',
    );
  });

  it('reaches: never emits a raw ISO date to the reader', () => {
    expect(connectionDepthSentence({ state: 'reaches', earliest: '2026-03-25' })).not.toContain('2026-03-25');
  });

  it('counted-elsewhere: claims the DATES belong elsewhere, never that the money is counted elsewhere', () => {
    // R1 is a calendar-WINDOW rule: a dropped row need not have a counterpart on the other
    // side, and the data-integrity critic executed the case where the register showed the row
    // on NEITHER account. "counted on the other account" would have been false there.
    const s = connectionDepthSentence({ state: 'counted-elsewhere' });
    expect(s).toBe(
      'No history of its own — every date it covers belongs to another account. See "Account cleanup" on this page.',
    );
    expect(s).not.toMatch(/counted on/);
  });

  it('counted-elsewhere: stays true when there is more than one claimant', () => {
    // Executed shapes: a mid-chain account whose rows go to two DIFFERENT accounts in opposite
    // directions; two sibling predecessors claiming one successor; a multi-account connection
    // each of whose accounts was combined with a different one. A NAMED, singular referent is
    // wrong in all three, so the sentence names none and reads distributively.
    const s = connectionDepthSentence({ state: 'counted-elsewhere' });
    expect(s).toContain('another account');
    expect(s).not.toMatch(/\bthe account it was combined with\b/);
  });

  it('counted-elsewhere: points at the disclosure that actually names the pairing', () => {
    // O.19 put the "Combined accounts" card inside the `Account cleanup` <details>, which
    // renders COLLAPSED — so without this pointer the sentence would be the first and only
    // place on the visible page to use the vocabulary, defining nothing.
    expect(connectionDepthSentence({ state: 'counted-elsewhere' })).toContain('"Account cleanup"');
  });

  it('balances-only: says nothing is coming, because nothing is', () => {
    // Investment, loan and mortgage accounts never send transactions — there is no
    // /investments/transactions ingest in this app at all. FOUR of the owner's thirteen live
    // connections are exactly this, and every one was being shown "No transactions yet."
    // while syncing cleanly the same morning.
    const s = connectionDepthSentence({ state: 'balances-only' });
    expect(s).toBe("Balances only — investment, loan and mortgage accounts don't send transactions.");
    expect(s).not.toMatch(/\byet\b/);
  });

  it('not-counted: names the currency guard, and does not call the account empty', () => {
    // The card NAMES a withheld account one line above, so "No transactions yet." would deny
    // rows it just listed.
    const s = connectionDepthSentence({ state: 'not-counted' });
    expect(s).toBe("Not counted here — these accounts aren't in U.S. dollars.");
    expect(s).not.toMatch(/\byet\b/);
  });

  it('no-rows: "yet" survives ONLY where something can actually arrive', () => {
    expect(connectionDepthSentence({ state: 'no-rows' })).toBe('No transactions yet.');
  });

  it('every state renders a non-empty sentence ending in a full stop', () => {
    // The exhaustive switch makes a missing branch a tsc error rather than a blank line; this
    // is the belt to that braces, and it fails loudly if a new state ever returns undefined.
    const all = [
      { state: 'reaches', earliest: '2024-08-11' },
      { state: 'counted-elsewhere' },
      { state: 'balances-only' },
      { state: 'not-counted' },
      { state: 'no-rows' },
    ] as const;
    for (const d of all) {
      const s = connectionDepthSentence(d);
      expect(s.length).toBeGreaterThan(0);
      expect(s.endsWith('.')).toBe(true);
    }
  });

  it('no two states render the same sentence', () => {
    // Five distinct facts; five distinct sentences. A collapse here is how "no transactions
    // yet" came to cover four connections it was false for.
    const sentences = [
      connectionDepthSentence({ state: 'reaches', earliest: '2024-08-11' }),
      connectionDepthSentence({ state: 'counted-elsewhere' }),
      connectionDepthSentence({ state: 'balances-only' }),
      connectionDepthSentence({ state: 'not-counted' }),
      connectionDepthSentence({ state: 'no-rows' }),
    ];
    expect(new Set(sentences).size).toBe(sentences.length);
  });
});
