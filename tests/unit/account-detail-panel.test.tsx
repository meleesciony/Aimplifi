// @vitest-environment jsdom
/**
 * Renders of the /accounts in-place detail panel (the mortgage dead-end slice,
 * U.3) — including, deliberately FIRST, the shape a REAL account gets before
 * U.4's writer has recorded a month for it (no snapshots, and no SimpleFIN loan
 * carries aprBps/minimum/due): the role line plus the honest no-history line.
 * The U.3 critic's finding #3 — the demo e2e alone proved only the seed's best
 * case.
 *
 * Since U.4 the panel also has to separate two things that look identical in a
 * list of dated figures: balances the bank actually sent, and the last one
 * repeated monthly after the feed went quiet.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// This config does not enable vitest globals, so RTL's auto-cleanup does not
// run — without this, renders accumulate and getBy* finds duplicates.
afterEach(cleanup);
import { AccountDetailPanel } from '@/components/finance/account-detail-panel';
import type { AccountView } from '@/lib/engine/transactions/query';

const mortgage: AccountView = {
  id: 'acct-m',
  name: 'Home Mortgage',
  type: 'MORTGAGE',
  mask: null,
  currentBalanceCents: 41230000,
};

describe('AccountDetailPanel', () => {
  it('a REAL synced mortgage — no snapshots, no loan facts — still answers the click with facts, not blanks', () => {
    render(
      <AccountDetailPanel
        account={mortgage}
        isLiability
        detail={{ id: 'acct-m', history: [], aprBps: null, minimumPaymentCents: null, dueDayOfMonth: null, feedDroppedAt: null }}
      />,
    );
    const panel = screen.getByTestId('account-detail-panel');
    expect(panel.textContent).toContain('Mortgage — counts toward your net worth as money you owe');
    expect(panel.textContent).toContain('tracked by its balance instead of an activity feed');
    // The honest absence, named — never an empty box, never a promise of
    // history no writer produces.
    expect(screen.getByTestId('account-detail-no-history').textContent).toContain(
      'No balance history recorded',
    );
    expect(screen.queryByTestId('account-detail-loan-facts')).toBeNull();
    expect(screen.queryByTestId('account-detail-history')).toBeNull();
  });

  it('loan facts render only the facts the feed supplied, formatted from their stored units', () => {
    render(
      <AccountDetailPanel
        account={{ ...mortgage, id: 'acct-l', type: 'LOAN' }}
        isLiability
        detail={{ id: 'acct-l', history: [], aprBps: 649, minimumPaymentCents: 38500, dueDayOfMonth: 5, feedDroppedAt: null }}
      />,
    );
    const facts = screen.getByTestId('account-detail-loan-facts');
    expect(facts.textContent).toContain('APR 6.49%');
    expect(facts.textContent).toContain('minimum payment $385.00');
    expect(facts.textContent).toContain('due on day 5 of the month');
  });

  it("history rows carry the row's own liability sign — the panel may never call the balance a different number than the line the reader tapped", () => {
    render(
      <AccountDetailPanel
        account={mortgage}
        isLiability
        detail={{
          id: 'acct-m',
          history: [
            { date: '2026-04-30', balanceCents: 41500000, accountType: 'MORTGAGE', countsInNetWorth: true, countedInstead: null },
            { date: '2026-05-31', balanceCents: 41230000, accountType: 'MORTGAGE', countsInNetWorth: true, countedInstead: null },
          ],
          aprBps: null,
          minimumPaymentCents: null,
          dueDayOfMonth: null,
          feedDroppedAt: null,
        }}
      />,
    );
    const history = screen.getByTestId('account-detail-history');
    expect(history.textContent).toContain('−$412,300.00');
    expect(history.textContent).toContain('−$415,000.00');
    expect(screen.queryByTestId('account-detail-no-history')).toBeNull();
  });

  it('rows recorded after the feed went quiet are marked carried-forward, never printed as readings (U.4 P0)', () => {
    // The mechanism: U.4 records EVERY account each month — including one the
    // bank stopped sharing — because the trend's totals must keep counting it
    // (L.14). So the list mixes balances the bank sent with the last one
    // repeated, and the amber note above this panel already tells the reader
    // "it has not changed since". Unmarked, a monthly column of identical dated
    // figures reads as proof the app has been checking all along.
    render(
      <AccountDetailPanel
        account={mortgage}
        isLiability
        detail={{
          id: 'acct-m',
          history: [
            { date: '2026-03-01', balanceCents: 31000000, accountType: 'MORTGAGE', countsInNetWorth: true, countedInstead: null }, // before the drop: a real reading
            { date: '2026-04-01', balanceCents: 31000000, accountType: 'MORTGAGE', countsInNetWorth: true, countedInstead: null }, // after: carried forward
            { date: '2026-05-01', balanceCents: 31000000, accountType: 'MORTGAGE', countsInNetWorth: true, countedInstead: null },
          ],
          aprBps: null,
          minimumPaymentCents: null,
          dueDayOfMonth: null,
          feedDroppedAt: '2026-03-15',
        }}
      />,
    );
    // Exactly the rows after the drop date, not the one before it.
    expect(screen.getAllByTestId('account-detail-carried')).toHaveLength(2);
    const note = screen.getByTestId('account-detail-carried-note').textContent ?? '';
    expect(note).toContain('2 rows repeat the last balance your bank sent');
    expect(note).toContain('Sun, Mar 15, 2026');
    expect(note).toContain('nothing has been read from this account since');
  });

  it('a live feed marks nothing as carried forward', () => {
    render(
      <AccountDetailPanel
        account={mortgage}
        isLiability
        detail={{
          id: 'acct-m',
          history: [{ date: '2026-05-01', balanceCents: 31000000, accountType: 'MORTGAGE', countsInNetWorth: true, countedInstead: null }],
          aprBps: null,
          minimumPaymentCents: null,
          dueDayOfMonth: null,
          feedDroppedAt: null,
        }}
      />,
    );
    expect(screen.queryByTestId('account-detail-carried')).toBeNull();
    expect(screen.queryByTestId('account-detail-carried-note')).toBeNull();
  });

  it('an asset account reads "money you own" and paints no minus sign', () => {
    render(
      <AccountDetailPanel
        account={{ ...mortgage, id: 'acct-re', name: 'Primary Home', type: 'REAL_ESTATE' }}
        isLiability={false}
        detail={{
          id: 'acct-re',
          history: [{ date: '2026-05-31', balanceCents: 65000000, accountType: 'REAL_ESTATE', countsInNetWorth: true, countedInstead: null }],
          aprBps: null,
          minimumPaymentCents: null,
          dueDayOfMonth: null,
          feedDroppedAt: null,
        }}
      />,
    );
    const panel = screen.getByTestId('account-detail-panel');
    expect(panel.textContent).toContain('money you own');
    expect(panel.textContent).toContain('$650,000.00');
    expect(panel.textContent).not.toContain('−$650,000.00');
  });

  // ── U.6: a row is signed by the class IT was recorded under ─────────────────
  describe('a row recorded under another class (U.6)', () => {
    it('keeps its own sign and says so on the row, instead of being repainted as what the account is now', () => {
      render(
        <AccountDetailPanel
          account={{ ...mortgage, id: 'acct-x', name: 'Flex Line', type: 'CREDIT' }}
          isLiability
          detail={{
            id: 'acct-x',
            history: [
              // Read while the feed still called it a checking account…
              { date: '2026-04-30', balanceCents: 500000, accountType: 'CHECKING', countsInNetWorth: true, countedInstead: null },
              // …and after the feed reclassified it.
              { date: '2026-05-31', balanceCents: 500000, accountType: 'CREDIT', countsInNetWorth: true, countedInstead: null },
            ],
            aprBps: null,
            minimumPaymentCents: null,
            dueDayOfMonth: null,
            feedDroppedAt: null,
          }}
        />,
      );
      const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
      // Newest first. The April row is the ASSET it was recorded as — pre-U.6
      // the panel painted both rows −$5,000.00 off the account's current type.
      expect(rows[0]).toContain('−$5,000.00');
      expect(rows[1]).toContain('$5,000.00');
      expect(rows[1]).not.toContain('−$5,000.00');
      // The sign difference is explained on the row that carries it, not left
      // for the reader to invent a story for.
      const marks = screen.getAllByTestId('account-detail-reclassified');
      expect(marks).toHaveLength(1);
      expect(marks[0].textContent).toContain('counted as checking');
      const note = screen.getByTestId('account-detail-reclassified-note').textContent ?? '';
      expect(note).toContain('One balance here was read');
      // What the APP did, not what was true in the world: a feed that re-classes
      // an account may be CORRECTING itself, so "you owned it then" would assert
      // the very thing in doubt.
      expect(note).toContain('while Aimplifi had this account classed differently');
      expect(note).toContain('on the own side of your net worth instead of the owe side');
      expect(note).toContain('only your bank can say');
      // The absolute that the NULL fallback in this same slice falsifies must
      // not be here: rows with no recorded class are counted by what the account
      // is TODAY, so "every balance the way it was recorded" is not true.
      expect(note).not.toContain('every balance');
    });

    it('says nothing when every row matches the account today', () => {
      render(
        <AccountDetailPanel
          account={mortgage}
          isLiability
          detail={{
            id: 'acct-m',
            history: [{ date: '2026-05-31', balanceCents: 41230000, accountType: 'MORTGAGE', countsInNetWorth: true, countedInstead: null }],
            aprBps: null,
            minimumPaymentCents: null,
            dueDayOfMonth: null,
            feedDroppedAt: null,
          }}
        />,
      );
      expect(screen.queryByTestId('account-detail-reclassified')).toBeNull();
      expect(screen.queryByTestId('account-detail-reclassified-note')).toBeNull();
    });

    it('a carried-forward row is never called a balance that was READ — the two notes cannot contradict', () => {
      // The panel says "nothing has been read from this account since Mar 15"
      // four lines above. A note claiming balances "were read" on April and May
      // — dates the app admits it read nothing on — attributes an observation to
      // a day it already disclaimed. The row keeps BOTH markers (its sign still
      // needs explaining); only the count of READ balances excludes them.
      render(
        <AccountDetailPanel
          account={{ ...mortgage, id: 'acct-q', name: 'Quiet Line', type: 'CREDIT' }}
          isLiability
          detail={{
            id: 'acct-q',
            history: [
              { date: '2026-03-01', balanceCents: 500000, accountType: 'CHECKING', countsInNetWorth: true, countedInstead: null }, // a real reading
              { date: '2026-04-01', balanceCents: 500000, accountType: 'CHECKING', countsInNetWorth: true, countedInstead: null }, // carried
              { date: '2026-05-01', balanceCents: 500000, accountType: 'CHECKING', countsInNetWorth: true, countedInstead: null }, // carried
            ],
            aprBps: null,
            minimumPaymentCents: null,
            dueDayOfMonth: null,
            feedDroppedAt: '2026-03-15',
          }}
        />,
      );
      expect(screen.getAllByTestId('account-detail-carried')).toHaveLength(2);
      // All three rows are marked — every one is counted on the other side.
      expect(screen.getAllByTestId('account-detail-reclassified')).toHaveLength(3);
      const note = screen.getByTestId('account-detail-reclassified-note').textContent ?? '';
      // ONE, not three: only the pre-drop row was actually read.
      expect(note).toContain('One balance here was read');
      expect(note).not.toContain('3 balances');
      // And the two markers do not run together into one token for a screen
      // reader or a textContent assertion.
      const firstRow = screen.getAllByRole('listitem')[0].textContent ?? '';
      expect(firstRow).not.toContain('carried forwardcounted as');
    });

    it('an ASSET account holding liability-classed rows says "owed", the direction nothing else renders', () => {
      render(
        <AccountDetailPanel
          account={{ ...mortgage, id: 'acct-a', name: 'Old Card', type: 'CHECKING' }}
          isLiability={false}
          detail={{
            id: 'acct-a',
            history: [{ date: '2026-04-30', balanceCents: 500000, accountType: 'CREDIT', countsInNetWorth: true, countedInstead: null }],
            aprBps: null,
            minimumPaymentCents: null,
            dueDayOfMonth: null,
            feedDroppedAt: null,
          }}
        />,
      );
      const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
      expect(rows[0]).toContain('−$5,000.00'); // counted as a liability THEN
      const note = screen.getByTestId('account-detail-reclassified-note').textContent ?? '';
      expect(note).toContain('on the owe side of your net worth instead of the own side');
    });

    it('names the rows whose class was never recorded, but only where class is already at issue', () => {
      // P0: the note must not let a reader take unmarked older rows as
      // confirmed. These predate the column, are signed by the account TODAY,
      // and say so — beside a known reclassification, which is when it matters.
      render(
        <AccountDetailPanel
          account={{ ...mortgage, id: 'acct-mix', name: 'Mixed', type: 'CREDIT' }}
          isLiability
          detail={{
            id: 'acct-mix',
            history: [
              { date: '2026-03-31', balanceCents: 500000, accountType: null, countsInNetWorth: true, countedInstead: null }, // pre-U.6
              { date: '2026-04-30', balanceCents: 500000, accountType: 'CHECKING', countsInNetWorth: true, countedInstead: null },
              { date: '2026-05-31', balanceCents: 500000, accountType: 'CREDIT', countsInNetWorth: true, countedInstead: null },
            ],
            aprBps: null,
            minimumPaymentCents: null,
            dueDayOfMonth: null,
            feedDroppedAt: null,
          }}
        />,
      );
      const unrecorded =
        screen.getByTestId('account-detail-unrecorded-class-note').textContent ?? '';
      expect(unrecorded).toContain('One balance predates');
      expect(unrecorded).toContain('credit card'); // counted as the account is today
      // The pre-U.6 row carries the account's current sign and NO marker: the
      // app cannot assert it differed.
      const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
      expect(rows[2]).toContain('−$5,000.00');
      expect(rows[2]).not.toContain('counted as');
    });

    it('does not raise the never-recorded note when nothing suggests the class ever moved', () => {
      // Every live account's rows are NULL until U.6 has been deployed a month,
      // so an unconditional note would fire on essentially every real panel —
      // note-blindness that hides the ones that matter.
      render(
        <AccountDetailPanel
          account={mortgage}
          isLiability
          detail={{
            id: 'acct-m',
            history: [
              { date: '2026-04-30', balanceCents: 41500000, accountType: null, countsInNetWorth: true, countedInstead: null },
              { date: '2026-05-31', balanceCents: 41230000, accountType: null, countsInNetWorth: true, countedInstead: null },
            ],
            aprBps: null,
            minimumPaymentCents: null,
            dueDayOfMonth: null,
            feedDroppedAt: null,
          }}
        />,
      );
      expect(screen.queryByTestId('account-detail-unrecorded-class-note')).toBeNull();
      expect(screen.queryByTestId('account-detail-reclassified-note')).toBeNull();
    });

    it('a row written before the column existed is signed by the account today, and claims nothing', () => {
      render(
        <AccountDetailPanel
          account={mortgage}
          isLiability
          detail={{
            id: 'acct-m',
            history: [{ date: '2026-05-31', balanceCents: 41230000, accountType: null, countsInNetWorth: true, countedInstead: null }],
            aprBps: null,
            minimumPaymentCents: null,
            dueDayOfMonth: null,
            feedDroppedAt: null,
          }}
        />,
      );
      // The pre-U.6 behaviour, and no marker — the app does not know what this
      // row was read under, so it must not assert that it differed.
      expect(screen.getByTestId('account-detail-history').textContent).toContain('−$412,300.00');
      expect(screen.queryByTestId('account-detail-reclassified')).toBeNull();
      expect(screen.queryByTestId('account-detail-reclassified-note')).toBeNull();
    });
  });

  // ── U.5: RECORDED here, COUNTED by the trend — not the same set ─────────────
  //
  // Combining two accounts drops one side of each same-dated pair from net
  // worth. The row is still a balance the bank sent for THIS account, so it is
  // shown; what it may not do is carry a claim about counting.
  describe('a row the net-worth trend does not count (U.5)', () => {
    const autoLoan = { ...mortgage, id: 'acct-c', name: 'Auto Loan', type: 'LOAN' };
    const combined = (
      history: {
        date: string;
        balanceCents: number;
        accountType: string | null;
        countsInNetWorth: boolean;
        countedInstead: { name: string; balanceCents: number; isLiability: boolean } | null;
      }[],
      feedDroppedAt: string | null = null,
    ) => (
      <AccountDetailPanel
        account={autoLoan}
        isLiability
        detail={{ id: 'acct-c', history, aprBps: null, minimumPaymentCents: null, dueDayOfMonth: null, feedDroppedAt }}
      />
    );
    const retired = { name: 'Auto Loan Retired', balanceCents: 1430000, isLiability: true };

    it('is still shown, and names the balance the trend counted for its date instead', () => {
      render(
        combined([
          { date: '2026-03-15', balanceCents: 1310000, accountType: 'LOAN', countsInNetWorth: false, countedInstead: retired },
          { date: '2026-05-15', balanceCents: 1290000, accountType: 'LOAN', countsInNetWorth: true, countedInstead: null },
        ]),
      );
      // Never hidden: deleting it would drop a balance the bank really sent.
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
      expect(screen.getByTestId('account-detail-history').textContent).toContain('−$13,100.00');
      // The figure the reader would otherwise never see — the panel showed the
      // balance net worth did NOT use and named no other (U.5 critic F4).
      const marks = screen.getAllByTestId('account-detail-not-counted');
      expect(marks).toHaveLength(1);
      expect(marks[0].textContent).toContain('your net worth counts −$14,300.00 from Auto Loan Retired');
      const note = screen.getByTestId('account-detail-not-counted-note').textContent ?? '';
      expect(note).toContain('One balance here is not in your net worth');
      expect(note).toContain('so the same account is not counted twice');
      // Points at the surface that shows the pair: the named account is folded
      // out of this page's groups, so it is otherwise a name with no home.
      expect(note).toContain('Account cleanup');
      // NOT the positional demonstrative L.19/L.20 removed from its sibling
      // builder, and not the false "double it" (the two balances differ).
      expect(note).not.toContain('not counted here');
      expect(note).not.toContain('double');
    });

    it('states only what is certain when the date’s owner is not this account’s direct counterpart', () => {
      render(
        combined([
          { date: '2026-03-15', balanceCents: 1310000, accountType: 'LOAN', countsInNetWorth: false, countedInstead: null },
          { date: '2026-04-15', balanceCents: 1310000, accountType: 'LOAN', countsInNetWorth: false, countedInstead: null },
        ]),
      );
      const marks = screen.getAllByTestId('account-detail-not-counted');
      expect(marks).toHaveLength(2);
      expect(marks[0].textContent).toContain('not in your net worth');
      // Never a guessed name, and never a stray null/undefined in the copy.
      expect(marks[0].textContent).not.toContain('undefined');
      expect(marks[0].textContent).not.toContain('null');
      const note = screen.getByTestId('account-detail-not-counted-note').textContent ?? '';
      expect(note).toContain('2 balances here are not in your net worth');
      expect(note).toContain('those dates');
    });

    it('an uncounted row keeps the marker that explains its SIGN — it just stops claiming the trend counted it', () => {
      // The U.5 critic's F3: the first draft gated the class marker on
      // `countsInNetWorth`, which left a POSITIVE figure inside a liability
      // account's history with nothing to explain it — re-opening precisely the
      // unexplained sign flip U.6 closed. The sign is not a counting claim.
      render(
        combined([
          { date: '2026-03-15', balanceCents: 500000, accountType: 'CHECKING', countsInNetWorth: false, countedInstead: retired },
          { date: '2026-05-15', balanceCents: 1290000, accountType: 'LOAN', countsInNetWorth: true, countedInstead: null },
        ]),
      );
      const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
      expect(rows[1]).toContain('$5,000.00');
      expect(rows[1]).not.toContain('−$5,000.00');
      // Explained, but as a RECORDING, never as a counting.
      const mark = screen.getByTestId('account-detail-reclassified');
      expect(mark.textContent).toContain('recorded as checking');
      expect(mark.textContent).not.toContain('counted as');
      // And the note that says which SIDE of net worth those dates land on does
      // not count a row that lands on neither.
      expect(screen.queryByTestId('account-detail-reclassified-note')).toBeNull();
    });

    it('the pre-U.6 note still fires beside a class marker on an UNCOUNTED row, and counts only rows that count', () => {
      // Two rules at once: its GATE is "is class instability visible here"
      // (which an uncounted row's marker makes true), while its COUNT is a
      // counting claim and may only tally counted rows.
      render(
        combined([
          { date: '2026-02-15', balanceCents: 500000, accountType: null, countsInNetWorth: false, countedInstead: retired },
          { date: '2026-03-15', balanceCents: 500000, accountType: null, countsInNetWorth: true, countedInstead: null },
          { date: '2026-04-15', balanceCents: 500000, accountType: 'CHECKING', countsInNetWorth: false, countedInstead: retired },
        ]),
      );
      const note = screen.getByTestId('account-detail-unrecorded-class-note').textContent ?? '';
      expect(note).toContain('One balance predates');
      expect(note).not.toContain('2 balances predate');
    });

    it('carried forward still marks an uncounted row — how the balance was obtained stays true of a row nothing counts', () => {
      render(
        combined(
          [{ date: '2026-05-15', balanceCents: 1430000, accountType: 'LOAN', countsInNetWorth: false, countedInstead: retired }],
          '2026-03-01',
        ),
      );
      expect(screen.getByTestId('account-detail-carried')).toBeTruthy();
      expect(screen.getByTestId('account-detail-not-counted')).toBeTruthy();
      // Two markers, two different facts, never run together as one token.
      expect(screen.getAllByRole('listitem')[0].textContent).toContain('· carried forward');
      expect(screen.getAllByRole('listitem')[0].textContent).toContain('· your net worth counts');
    });

    it('nothing combined → not one word of any of it (the golden panel is byte-identical)', () => {
      render(
        combined([
          { date: '2026-05-15', balanceCents: 1290000, accountType: 'LOAN', countsInNetWorth: true, countedInstead: null },
        ]),
      );
      expect(screen.queryByTestId('account-detail-not-counted')).toBeNull();
      expect(screen.queryByTestId('account-detail-not-counted-note')).toBeNull();
    });
  });
});
