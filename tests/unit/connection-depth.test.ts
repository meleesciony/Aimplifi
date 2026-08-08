/**
 * TASKS H.1(b) — the pure per-connection depth engine.
 *
 * The shapes here are the ones the live corpus actually produced on 2026-08-08
 * (`scripts/audit-probes/h1-connection-depth.mts`, read-only, re-run this
 * session): a connection whose owned floor sits ~3 months after its raw floor,
 * a connection holding rows it owns none of, connections holding nothing at
 * all, and a multi-account connection whose depth comes from one deep account.
 */
import { describe, expect, it } from 'vitest';

import { connectionHistoryDepth } from '@/lib/engine/account/connection-depth';

describe('connectionHistoryDepth', () => {
  it('reaches back to the OLDEST date any of its accounts owns', () => {
    // Live shape: Charles Schwab (item ed9n8rMQ…) — 8 accounts, one of which
    // reaches furthest. The connection's answer is that account's floor.
    expect(
      connectionHistoryDepth([
        { inRegisterBasis: true, neverTransactional: false, earliestOwned: '2026-07-22', holdsRows: true },
        { inRegisterBasis: true, neverTransactional: false, earliestOwned: '2026-07-20', holdsRows: true },
        { inRegisterBasis: true, neverTransactional: false, earliestOwned: '2026-08-04', holdsRows: true },
      ]),
    ).toEqual({ state: 'reaches', earliest: '2026-07-20' });
  });

  it('ignores the raw floor entirely — only OWNED dates set the depth', () => {
    // The 84–91-day deltas the probe measured: the account holds rows from
    // 2026-04-24 but owns nothing before 2026-07-21. The caller has already
    // applied the keep rule, so the engine must never see (or invent) the
    // raw date; a connection whose sole account owns one late row reports
    // that late row, not the older one the register does not show.
    expect(connectionHistoryDepth([{ inRegisterBasis: true, neverTransactional: false, earliestOwned: '2026-07-21', holdsRows: true }])).toEqual({
      state: 'reaches',
      earliest: '2026-07-21',
    });
  });

  it('a connection holding rows it owns NONE of never renders a date', () => {
    // Live Q3 hit: American Express (item PpJ4mZwE…) holds 7 rows, owns 0.
    // A date here would be a fabrication; "no transactions yet" would be false
    // in the other direction.
    expect(connectionHistoryDepth([{ inRegisterBasis: true, neverTransactional: false, earliestOwned: null, holdsRows: true }])).toEqual({
      state: 'counted-elsewhere',
    });
  });

  it('distinguishes "owns none of what it holds" from "holds nothing"', () => {
    // Live shape: Vanguard / Truist / U.S. Bank / Schwab (Y8vQX7Yq…) — real
    // connections, real accounts, zero transaction rows.
    expect(connectionHistoryDepth([{ inRegisterBasis: true, neverTransactional: false, earliestOwned: null, holdsRows: false }])).toEqual({
      state: 'no-rows',
    });
  });

  it('one owning account outvotes any number of disowned siblings', () => {
    expect(
      connectionHistoryDepth([
        { inRegisterBasis: true, neverTransactional: false, earliestOwned: null, holdsRows: true },
        { inRegisterBasis: true, neverTransactional: false, earliestOwned: null, holdsRows: true },
        { inRegisterBasis: true, neverTransactional: false, earliestOwned: '2024-08-11', holdsRows: true },
      ]),
    ).toEqual({ state: 'reaches', earliest: '2024-08-11' });
  });

  it('a connection with no accounts at all holds nothing', () => {
    expect(connectionHistoryDepth([])).toEqual({ state: 'no-rows' });
  });

  it('an account that holds nothing does not drag a sibling connection to "counted-elsewhere"', () => {
    // Mixed: one empty investment account beside one funded card. The empty one
    // must not be read as evidence of anything (it holds no rows to be claimed).
    expect(
      connectionHistoryDepth([
        { inRegisterBasis: true, neverTransactional: false, earliestOwned: null, holdsRows: false },
        { inRegisterBasis: true, neverTransactional: false, earliestOwned: '2026-05-18', holdsRows: true },
      ]),
    ).toEqual({ state: 'reaches', earliest: '2026-05-18' });
  });

  it('REGRESSION — a connection whose accounts are ALL outside the register says so, and never a date', () => {
    // test_regression__connection_depth_uses_the_registers_basis (critic F-1, executed).
    // Live today: a Truist connection whose ONLY account is a mortgage, and a mortgage account
    // elsewhere in this corpus already holding three rows. Those rows exist and /transactions
    // lists none of them, so a date here is one the register denies on the same screenload.
    expect(
      connectionHistoryDepth([
        { inRegisterBasis: false, neverTransactional: true, earliestOwned: '2026-05-18', holdsRows: true },
      ]),
    ).toEqual({ state: 'balances-only' });
  });

  it('an out-of-basis account can neither set a date NOR make its connection look empty', () => {
    // The mixed connection: Charles Schwab's 7 INVESTMENT accounts beside 1 CHECKING. The
    // checking's floor is the answer; the investment rows neither win nor interfere.
    expect(
      connectionHistoryDepth([
        { inRegisterBasis: false, neverTransactional: true, earliestOwned: '2020-01-01', holdsRows: true },
        { inRegisterBasis: true, neverTransactional: false, earliestOwned: '2026-07-22', holdsRows: true },
      ]),
    ).toEqual({ state: 'reaches', earliest: '2026-07-22' });
  });

  it('a withheld non-USD account is NOT called empty and NOT called balances-only', () => {
    // Critic F-3: names come from the unfiltered account list, so a card that lists
    // "London Card" and then says "No transactions yet." contradicts itself one line up.
    expect(
      connectionHistoryDepth([
        { inRegisterBasis: false, neverTransactional: false, earliestOwned: null, holdsRows: false },
      ]),
    ).toEqual({ state: 'not-counted' });
  });

  it('"no accounts at all" and "no accounts the register lists" are different sentences', () => {
    expect(connectionHistoryDepth([])).toEqual({ state: 'no-rows' });
    expect(
      connectionHistoryDepth([
        { inRegisterBasis: false, neverTransactional: true, earliestOwned: null, holdsRows: false },
      ]),
    ).not.toEqual({ state: 'no-rows' });
  });

  it('compares dates as calendar strings, across a year boundary', () => {
    // YYYY-MM-DD ordering is the repo's date convention; 2024-12-12 sorts before
    // 2025-01-02 without any Date parsing (the live demo corpus's own floor).
    expect(
      connectionHistoryDepth([
        { inRegisterBasis: true, neverTransactional: false, earliestOwned: '2025-01-02', holdsRows: true },
        { inRegisterBasis: true, neverTransactional: false, earliestOwned: '2024-12-12', holdsRows: true },
      ]),
    ).toEqual({ state: 'reaches', earliest: '2024-12-12' });
  });
});
