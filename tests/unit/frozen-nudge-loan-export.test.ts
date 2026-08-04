/**
 * TASKS L.20 — the three places a frozen account's fact was stripped on its way to the reader.
 *
 * One disease, three faces. `feedDroppedAt` rides the money out of the providers and is then
 * dropped at a narrowing: the Today feed's `Proposal` had no slot for it, the PDF export's account
 * payload left it behind (under a footer asserting the opposite), and `selectLoanObligations`
 * discarded an undatable loan whole — so the one row that could reach NO list was also the one row
 * no all-clear could qualify.
 *
 * ABSTENTIONS ARE THE MAJORITY, deliberately (`context-carrying-features-must-abstain.md`): the
 * defect this work can introduce is a caveat attached to a figure the frozen account does not feed,
 * and on an INSTRUCTION a false hedge makes a reader under-fund. Every "it speaks" case has its
 * "it stays silent" twin, and the silent ones are pinned to GOLDEN LITERALS rather than compared
 * against the code's own default output — `f(x, []) === f(x)` cannot fail (the L.15 finding).
 */
import { describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { cents, type Cents } from '@/lib/money';
import {
  type LoanAccountLike,
  selectLoanObligations,
  selectUndatableFrozenLoans,
} from '@/lib/engine/loans/obligations';
import {
  frozenNoWarningNote,
  frozenNothingDueNote,
  frozenNothingDueRows,
} from '@/lib/engine/account/feed-dropped-view';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  NET_WORTH_REPORT_FOOTER,
  NET_WORTH_REPORT_USABLE_WIDTH,
  activeNetWorthReportAccounts,
  netWorthAccountLine,
  netWorthFrozenNote,
  wrapToWidth,
} from '@/lib/export';
import { proposalFrozenNote } from '@/components/dashboard/today-feed-copy';
import type { Proposal, ProposalKind } from '@/lib/engine/nudge/types';

const TODAY = isoDate('2026-06-10');
const HOL: ReturnType<typeof isoDate>[] = [];
const DROPPED = '2026-05-02';

const FUNDING = { label: 'Everyday Checking', frozenSince: DROPPED, balanceCents: 120_000 };

function loan(over: Partial<LoanAccountLike> & { id: string }): LoanAccountLike {
  return {
    name: 'Loan',
    type: 'LOAN',
    minimumPaymentCents: 45_000,
    dueDayOfMonth: 14,
    ...over,
  };
}

function prop(o: { kind: ProposalKind; centsAtStake: number; fundingFrozen: Proposal['fundingFrozen'] }): Proposal {
  return {
    kind: o.kind,
    tier: 'critical',
    key: 'k',
    dismissKey: 'k',
    subjectKey: `nudge:${o.kind}` as Proposal['subjectKey'],
    sortDate: null,
    daysUntil: null,
    centsAtStake: cents(o.centsAtStake) as Cents,
    autopayCents: cents(0) as Cents,
    merchant: null,
    typicalCents: null,
    typicalCount: null,
    cadence: null,
    runwayMonths: null,
    runwayWindowMonths: null,
    isEstimated: false,
    fundingFrozen: o.fundingFrozen,
    dismissed: false,
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Driven through BOTH real selectors, because the claim being locked is that they are complements:
 * a loan is in the undatable list precisely when the dated list refused it. A hand-built row list
 * could not catch the two drifting apart, which is the only way this gap can reopen.
 */
describe('an undatable frozen loan reaches no list — and now says so', () => {
  const UNDATABLE_FROZEN = loan({
    id: 'mortgage-undated',
    name: 'Home Mortgage',
    type: 'MORTGAGE',
    dueDayOfMonth: null,
    minimumPaymentCents: 250_000,
    feedDroppedAt: DROPPED,
  });
  const NO_PAYMENT_FROZEN = loan({
    id: 'loan-nopay',
    name: 'Auto Loan',
    dueDayOfMonth: 9,
    minimumPaymentCents: 0,
    feedDroppedAt: DROPPED,
  });
  const DATABLE_FROZEN = loan({ id: 'loan-dated', name: 'Student Loan', feedDroppedAt: DROPPED });
  const UNDATABLE_LIVE = loan({ id: 'loan-live', name: 'Personal Loan', dueDayOfMonth: null });
  const CHECKING = loan({ id: 'chk', name: 'Everyday Checking', type: 'CHECKING', feedDroppedAt: DROPPED });

  const ALL = [CHECKING, UNDATABLE_FROZEN, NO_PAYMENT_FROZEN, DATABLE_FROZEN, UNDATABLE_LIVE];

  it('the two lists are exact complements over one account set', () => {
    const dated = selectLoanObligations({ accounts: ALL, today: TODAY, holidays: HOL }).map(
      (l) => l.accountId,
    );
    const undated = selectUndatableFrozenLoans({ accounts: ALL }).map((l) => l.accountId);
    expect(dated).toEqual(['loan-dated']);
    // BOTH undatable shapes are carried — a missing due day and a non-positive payment.
    expect(undated).toEqual(['loan-nopay', 'mortgage-undated']);
    expect(dated.filter((id) => undated.includes(id))).toEqual([]);
  });

  it('a LIVE undatable loan is NOT carried — its gap is a different claim (abstention)', () => {
    // Deliberate scope, not an oversight: a live loan's missing due day may still arrive, and the
    // sentence below states that it cannot. Naming the wrong mechanism is the defect `kind` exists
    // to prevent, so the live case is left to the sibling gap recorded in docs/STATUS.md.
    expect(selectUndatableFrozenLoans({ accounts: [UNDATABLE_LIVE] })).toEqual([]);
  });

  it('a frozen NON-loan is never carried, however undatable', () => {
    expect(selectUndatableFrozenLoans({ accounts: [CHECKING] })).toEqual([]);
  });

  it('the row gets the UNDATABLE mechanism, not the datable-loan one', () => {
    const rows = frozenNothingDueRows({
      cards: [],
      loans: [],
      undatableLoans: selectUndatableFrozenLoans({ accounts: [UNDATABLE_FROZEN] }),
      partnerLabel: {},
    });
    // `missing: 'due-day'` — this fixture reports a $2,500 payment and no due date, which is the
    // COMMON shape a bank sends (L.20 critic cycle, finding B-2).
    expect(rows).toEqual([
      {
        label: 'Home Mortgage',
        frozenSince: DROPPED,
        ownership: 'reader',
        kind: 'undatable-loan',
        missing: 'due-day',
      },
    ]);
    const note = frozenNothingDueNote(rows, { nextStep: 'accounts-route' })!;
    expect(note).toContain('we hold no due date for it');
    // FAIL-OLD: the pre-fix sentence denied holding a payment amount we hold and display.
    expect(note).not.toContain('no due date and no payment amount');
    expect(note).not.toContain('we hold no payment amount');
    expect(note).toContain('it is in no payment list at all');
    // No positional word: one of the four callers of this builder is an EMAIL (finding A-5).
    expect(note).not.toContain('here at all');
    // The half a reader must not be left to infer: waiting will not fix it. Stated as NECESSITY —
    // while the account is unshared none can arrive — never as a promise that reconnecting will
    // produce one, which would be false for a loan the bank simply never dates (finding A-6).
    expect(note).toContain('one cannot arrive while the account is not being shared');
    expect(note).not.toContain('until that is fixed');
    // And NOT the datable wording, which would describe a stored due date it does not have.
    expect(note).not.toContain('a change to its payment or due date since');
  });

  it('the sentence names the field we actually lack, in each of the three shapes (B-2)', () => {
    const rowsFor = (accounts: LoanAccountLike[]) =>
      frozenNothingDueRows({
        cards: [],
        loans: [],
        undatableLoans: selectUndatableFrozenLoans({ accounts }),
        partnerLabel: {},
      });
    // Payment held, no due day — what Plaid returns for an issuer that reports no next payment
    // date. The app prints that payment on /accounts, so denying we hold it is false.
    expect(frozenNothingDueNote(rowsFor([UNDATABLE_FROZEN]), { nextStep: 'accounts-route' })).toContain(
      'we hold no due date for it',
    );
    // Due day held, no payment amount.
    expect(frozenNothingDueNote(rowsFor([NO_PAYMENT_FROZEN]), { nextStep: 'accounts-route' })).toContain(
      'we hold no payment amount for it',
    );
    // Neither.
    const both = loan({ id: 'l-both', name: 'Boat Loan', dueDayOfMonth: null, minimumPaymentCents: null, feedDroppedAt: DROPPED });
    expect(frozenNothingDueNote(rowsFor([both]), { nextStep: 'accounts-route' })).toContain(
      'we hold no due date and no payment amount for it',
    );
    // Rows that disagree about WHICH field is missing cannot share a clause, any more than a card
    // and a loan can: three shapes in one list produce three sentences.
    const note = frozenNothingDueNote(
      rowsFor([UNDATABLE_FROZEN, NO_PAYMENT_FROZEN, both]),
      { nextStep: 'accounts-route' },
    )!;
    expect(note).toContain('we hold no due date and no payment amount for it');
    expect(note).toContain('we hold no due date for it');
    expect(note).toContain('we hold no payment amount for it');
  });

  it('three kinds in one all-clear produce three claims, in a fixed order', () => {
    const rows = frozenNothingDueRows({
      cards: [{ cardId: 'card-1', cardName: 'Chase Sapphire', frozenSince: DROPPED }],
      loans: [{ accountId: 'loan-dated', accountName: 'Student Loan', frozenSince: DROPPED }],
      undatableLoans: [
        { accountId: 'mortgage-undated', accountName: 'Home Mortgage', frozenSince: DROPPED, missing: 'both' },
      ],
      partnerLabel: {},
    });
    expect(rows.map((r) => r.kind)).toEqual(['card', 'loan', 'undatable-loan']);
    const note = frozenNothingDueNote(rows, { nextStep: 'accounts-route' })!;
    // Order is the KIND order, never the order rows arrived in.
    expect(note.indexOf('Chase Sapphire')).toBeLessThan(note.indexOf('Student Loan'));
    expect(note.indexOf('Student Loan')).toBeLessThan(note.indexOf('Home Mortgage'));
    expect(note).toContain('a statement issued on it since');
    expect(note).toContain('a change to its payment or due date since');
    expect(note).toContain('we hold no due date and no payment amount for it');
  });

  it('a partner’s undatable loan drops the reader-only remedy and the second person', () => {
    const rows = frozenNothingDueRows({
      cards: [],
      loans: [],
      undatableLoans: [
        { accountId: 'mortgage-undated', accountName: 'Home Mortgage (Sam)', frozenSince: DROPPED, missing: 'both' },
      ],
      partnerLabel: { 'mortgage-undated': 'Sam' },
    });
    const note = frozenNothingDueNote(rows, { nextStep: 'accounts-route' })!;
    expect(note).toContain('Only the household member who owns it can reconnect it.');
    expect(note).not.toContain('Accounts shows the connection');
    expect(note).not.toContain('Your bank');
  });

  it('one account cannot claim BOTH a stale due date and no due date at all', () => {
    // Latent by construction (the selectors are complements), but the failure direction is a
    // self-contradiction on one screen, so the dedupe key is shared across both loan kinds.
    const rows = frozenNothingDueRows({
      cards: [],
      loans: [{ accountId: 'dup', accountName: 'Home Mortgage', frozenSince: DROPPED }],
      undatableLoans: [{ accountId: 'dup', accountName: 'Home Mortgage', frozenSince: DROPPED, missing: 'both' }],
      partnerLabel: {},
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('loan'); // holding a dated obligation is what makes a loan datable
  });

  it('a row with no drop date is still filtered out by the builder', () => {
    expect(
      frozenNothingDueRows({
        cards: [],
        loans: [],
        undatableLoans: [{ accountId: 'x', accountName: 'Personal Loan', frozenSince: null, missing: 'both' }],
        partnerLabel: {},
      }),
    ).toEqual([]);
  });

  it('omitting the new input is byte-identical to the pre-L.20 sentence (golden literal)', () => {
    const rows = frozenNothingDueRows({
      cards: [{ cardId: 'card-1', cardName: 'Chase Sapphire', frozenSince: DROPPED }],
      loans: [],
      partnerLabel: {},
    });
    expect(frozenNothingDueNote(rows, { nextStep: 'accounts-route' })).toBe(
      'Your bank stopped sharing Chase Sapphire on Sat, May 2, 2026, so a statement issued on it since would not have reached us — this covers only what we can still see. Accounts shows the connection and how to fix or remove it.',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('the Today feed states its own claim, and borrows none', () => {
  it('the no-warning note is about an ABSENCE — no projection, and no claim the feed is empty', () => {
    const note = frozenNoWarningNote(FUNDING, { nextStep: 'accounts-route' });
    expect(note).toContain("Everyday Checking's balance of $1,200.00");
    expect(note).toContain('has not updated since Sat, May 2, 2026');
    // CONDITIONAL, not positional (L.20 critic cycle, finding B-10a): this paragraph renders
    // directly beneath whatever headline the feed has, so "the absence of a warning here" could
    // sit immediately below a visible payment-due warning.
    expect(note).toContain(
      'if neither has flagged a problem, that silence rests on a figure we cannot refresh',
    );
    expect(note).not.toContain('absence of a warning here');
    // `frozenProjectionNote` opens "This projection starts from…", which is false on a feed that
    // renders no projection — the antecedent-less phrasing L.19 had to correct twice.
    expect(note).not.toContain('This projection');
    // The fact is carried whenever no proposal states it, and an unrelated opportunity can sit at
    // the top of an otherwise quiet feed, so the sentence may not call the feed empty.
    expect(note).not.toContain('empty');
    expect(note).toContain('Accounts shows the connection and how to fix or remove it.');
  });

  it('the shortfall row is qualified as an INSTRUCTION; the dip row as a projection', () => {
    const shortfall = proposalFrozenNote(
      prop({ kind: 'cash_needed_shortfall', centsAtStake: 25_000, fundingFrozen: FUNDING }),
    )!;
    expect(shortfall).toContain('Treat the amount as a floor and check the account first.');
    expect(shortfall).toContain('understates what you need to move');

    const dip = proposalFrozenNote(
      prop({ kind: 'cash_flow_dip', centsAtStake: 50_000, fundingFrozen: FUNDING }),
    )!;
    expect(dip).toContain('the dip comes sooner and the amount to move is larger than shown');
    expect(dip).not.toContain('Treat the amount as a floor');
  });

  it('a dip with NO transfer takes the deeper-dip consequence, read from the printed figure', () => {
    // `shows` is read from `centsAtStake` — the same value the detail line uses to decide whether
    // it prints a transfer — so the qualifier always describes the sentence actually on screen.
    const dip = proposalFrozenNote(
      prop({ kind: 'cash_flow_dip', centsAtStake: 0, fundingFrozen: FUNDING }),
    )!;
    expect(dip).toContain('the dip comes sooner and goes deeper than shown');
    expect(dip).not.toContain('the amount to move is larger');
  });

  it('no other kind may borrow a sentence saying its figure rests on that balance', () => {
    for (const kind of ['payment_due', 'unusual_charge', 'income_pause', 'price-increase'] as const) {
      expect(proposalFrozenNote(prop({ kind, centsAtStake: 60_000, fundingFrozen: FUNDING }))).toBeNull();
    }
  });

  it('a live funding balance says nothing at all (abstention)', () => {
    expect(
      proposalFrozenNote(
        prop({ kind: 'cash_needed_shortfall', centsAtStake: 25_000, fundingFrozen: null }),
      ),
    ).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('the net-worth report stops asserting what it never checked', () => {
  const LIVE = { id: 'acc-live', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 500_000, feedDroppedAt: null };
  const FROZEN = { id: 'acc-frozen', name: 'Vanguard Brokerage', type: 'INVESTMENT', currentBalanceCents: 421_055, feedDroppedAt: DROPPED };

  it('the footer no longer claims the balances are current', () => {
    // The old line — "Balances reflect the data source at export time" — is affirmatively FALSE
    // about a frozen row: the source stopped sending one, so the figure predates the export. This
    // is a durable artifact handed to a lender, with no way to correct itself afterwards.
    expect(NET_WORTH_REPORT_FOOTER).not.toContain('at export time');
    expect(NET_WORTH_REPORT_FOOTER).toContain('the most recent figures each source sent us');
    expect(NET_WORTH_REPORT_FOOTER).toContain('Educational, not financial advice.');
  });

  it('a frozen row is marked on the row itself; a live row is untouched', () => {
    expect(netWorthAccountLine(FROZEN)).toContain('- not updated since 2026-05-02');
    expect(netWorthAccountLine(LIVE)).toBe('Everyday Checking  (CHECKING)  $5,000.00');
  });

  it('the summary note names the account and BOTH figures the frozen balance is inside', () => {
    const note = netWorthFrozenNote([LIVE, FROZEN])!;
    expect(note).toContain('Vanguard Brokerage');
    expect(note).toContain('Sat, May 2, 2026');
    expect(note).toContain('still counted in the net worth and trend in this report');
    // A file holds no control: it may name the app, and nothing inside it.
    expect(note).toContain('Open Aimplifi to see the connection and how to fix it.');
    expect(note).not.toContain('Accounts shows');
  });

  it('an all-live report prints no note at all (abstention)', () => {
    expect(netWorthFrozenNote([LIVE])).toBeNull();
    expect(netWorthFrozenNote([])).toBeNull();
  });

  // ── L.20 critic cycle ──────────────────────────────────────────────────────────────────────
  it('every liability type prints as a NEGATIVE, so the rows reconcile to the headline (A-3)', () => {
    // `netWorthCents` subtracts all four LIABILITY_TYPES. The line used to compare against
    // CREDIT and LOAN only, so a $310,000 mortgage printed as a positive number in a report
    // whose net worth had subtracted it — the rows disagreed with the total by twice the
    // mortgage, in a document handed to a lender. Both missing types are user-creatable from
    // the manual-account form, so this needed no bank at all to reach.
    const owed = { id: 'x', currentBalanceCents: 310_000_00, feedDroppedAt: null };
    expect(netWorthAccountLine({ ...owed, name: 'Home Mortgage', type: 'MORTGAGE' })).toContain(
      '-$310,000.00',
    );
    expect(netWorthAccountLine({ ...owed, name: 'Family Loan', type: 'OTHER_LIABILITY' })).toContain(
      '-$310,000.00',
    );
    expect(netWorthAccountLine({ ...owed, name: 'Sapphire', type: 'CREDIT' })).toContain('-$310,000.00');
    expect(netWorthAccountLine({ ...owed, name: 'Auto Loan', type: 'LOAN' })).toContain('-$310,000.00');
    // An asset keeps its bare figure — the sign is the classifier's, not decoration.
    expect(netWorthAccountLine({ ...owed, name: 'Savings', type: 'DEPOSITORY' })).toContain('$310,000.00');
    expect(netWorthAccountLine({ ...owed, name: 'Savings', type: 'DEPOSITORY' })).not.toContain('-$');
  });

  it('the frozen note FITS the page, so its scope and remedy actually render (A-2)', async () => {
    // `pdf-lib` does not wrap: an over-wide line runs off the right edge and is clipped. Measured
    // before the fix, this note was 861.6pt against 516pt of usable width, and the two clauses
    // that fell off were the SCOPE ("in the net worth and trend in this report") and the whole
    // REMEDY — the visible half ended mid-word on "still co". Measuring against pdf-lib's own
    // Helvetica metrics is what makes this a test of the artifact rather than of the string.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const measure = (s: string) => font.widthOfTextAtSize(s, 8);
    for (const accounts of [[LIVE, FROZEN], [FROZEN, { ...FROZEN, id: 'acc-frozen-2', name: 'Chase Sapphire', type: 'CREDIT' }]]) {
      const note = netWorthFrozenNote(accounts)!;
      const lines = wrapToWidth(note, measure, NET_WORTH_REPORT_USABLE_WIDTH);
      expect(lines.length).toBeGreaterThan(1); // it genuinely needs more than one line
      for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(NET_WORTH_REPORT_USABLE_WIDTH);
      // Nothing is dropped or duplicated by the wrap: the lines rejoin to the exact sentence.
      expect(lines.join(' ')).toBe(note);
      // The clause that used to be clipped is on the page.
      expect(lines.join(' ')).toContain('Open Aimplifi to see the connection');
    }
  });

  it('a superseded predecessor is not printed, and is not called "still counted" (A-1)', () => {
    // The assembler zeroes a superseded predecessor, so it reaches this report at $0.00 — and the
    // note would then tell a lender that $0.00 is "still counted in the net worth and trend in
    // this report". Already fixed once for the dashboard banner; the PDF path never got it.
    const predecessor = { ...FROZEN, id: 'acc-old', name: 'Chase ····0977 (old)', currentBalanceCents: 0 };
    const rows = [LIVE, predecessor];
    expect(activeNetWorthReportAccounts(rows, ['acc-old'])).toEqual([LIVE]);
    expect(netWorthFrozenNote(activeNetWorthReportAccounts(rows, ['acc-old']))).toBeNull();
    // Fail-old direction: unfiltered, it makes exactly the false claim.
    expect(netWorthFrozenNote(rows)).toContain('still counted');
    // A frozen row that is NOT superseded still speaks (the abstention must not over-reach).
    expect(activeNetWorthReportAccounts([LIVE, FROZEN], ['acc-old'])).toEqual([LIVE, FROZEN]);
    expect(netWorthFrozenNote(activeNetWorthReportAccounts([LIVE, FROZEN], ['acc-old']))).toContain(
      'Vanguard Brokerage',
    );
  });
});
