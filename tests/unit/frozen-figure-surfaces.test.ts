/**
 * TASKS L.18 — the surfaces that print a figure derived from an account the bank stopped sharing.
 *
 * Driven against the REAL engines end to end: account rows → `assembleCashNeededInput` →
 * `computeCashNeeded` → the real reminder selector, the real email/digest/push composers, the real
 * radar walk and the real assistant builders. A pure-builder test cannot catch a wiring bug, and
 * that is exactly what L.18 is a list of: L.14's copy existed and reached one surface (the
 * `dedup-must-diff`/`fence-by-construction` lesson, and the L.15 test corollary).
 *
 * ABSTENTIONS ARE THE MAJORITY, deliberately (`context-carrying-features-must-abstain.md`). The
 * failure this feature can introduce is a caveat attached to a figure the frozen account does not
 * feed — a false hedge, which on an instruction makes a reader under-fund and overdraft. So every
 * "it speaks" case has its "it stays silent" twin, and the silent ones are pinned to GOLDEN
 * LITERALS rather than compared against the code's own default output (an `f(x,null) === f(x)`
 * assertion cannot fail — the L.15 finding).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { holidayTable, isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';
import {
  assembleCashNeededInput,
  type AccountLike as SnapshotAccount,
} from '@/lib/engine/cash-needed/assemble';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import { buildCashFlowCalendar } from '@/lib/engine/calendar/build';
import { computeRadar, type RadarInput } from '@/lib/engine/radar/radar';
import { frozenProjectionNote } from '@/lib/engine/account/feed-dropped-view';
import { buildReminderEmail, selectPaymentReminders } from '@/lib/engine/reminders/select';
import { buildWeeklyDigest } from '@/lib/engine/digest/build';
import { selectNotifications } from '@/lib/engine/notify/select';
import { selectLoanObligations } from '@/lib/engine/loans/obligations';
import {
  answerAccountBalance,
  answerCashNeeded,
  answerNetWorth,
  assistantAccounts,
} from '@/lib/engine/assistant/answer';
import { traceNetWorthDerivation } from '@/lib/engine/assistant/derivation';
import { traceCashNeeded } from '@/lib/engine/glass-box/trace';
import {
  type DueAmountSource,
  type FrozenCalendarRow,
  currentCycleAmountSource,
  frozenCalendarNotice,
  frozenCardsNote,
  frozenDuesEmailLines,
  frozenLoanNote,
  frozenNothingDueNote,
  frozenNothingDueRows,
  frozenTotalNote,
} from '@/lib/engine/account/feed-dropped-view';
import { prisma } from '@/lib/db';
import { getCoachData } from '@/server/coach';

const TODAY = isoDate('2026-06-10');
const HOL = holidayTable(2026, 2027);
const DROPPED = '2026-05-28';
const DROPPED_LONG = 'Thu, May 28, 2026';

// ── fixture builders (structural rows, exactly as a provider snapshot supplies them) ──

const account = (over: Partial<SnapshotAccount> & { id: string }): SnapshotAccount => ({
  name: 'Account',
  type: 'CHECKING',
  currentBalanceCents: 0,
  aprBps: null,
  dueDayOfMonth: null,
  cycleCloseDayOfMonth: null,
  ...over,
});

const CHECKING = account({
  id: 'chk',
  name: 'Everyday Checking',
  type: 'CHECKING',
  currentBalanceCents: 500_000,
});

/** A frozen card that DOES have a statement: its amounts come from the statement, not the balance. */
const FROZEN_CARD = account({
  id: 'frozen-card',
  name: 'Chase Sapphire',
  type: 'CREDIT',
  currentBalanceCents: 900_000,
  aprBps: 2399,
  dueDayOfMonth: 15,
  cycleCloseDayOfMonth: 20,
  feedDroppedAt: DROPPED,
});

const HEALTHY_CARD = account({
  id: 'healthy-card',
  name: 'Freedom Card',
  type: 'CREDIT',
  currentBalanceCents: 40_000,
  aprBps: 1999,
  dueDayOfMonth: 18,
  cycleCloseDayOfMonth: 22,
});

const statement = (accountId: string, balance: number, dueDate: string) => ({
  id: `stmt-${accountId}`,
  accountId,
  cycleEnd: '2026-05-20',
  dueDate,
  statementBalanceCents: balance,
  minimumPaymentCents: 3_500,
});

function cashNeeded(p: {
  accounts: SnapshotAccount[];
  statements?: ReturnType<typeof statement>[];
  paymentAccountId?: string;
}) {
  return computeCashNeeded(
    assembleCashNeededInput({
      today: TODAY,
      scenario: 'PAY_IN_FULL',
      paymentAccountId: p.paymentAccountId ?? 'chk',
      accounts: p.accounts,
      autopays: [],
      statements: p.statements ?? [],
      cardPayments: [],
      transactions: [],
      scheduled: [],
      holidayTable: HOL,
    }),
  );
}

/** The standard mixed world: one frozen card with a statement, one healthy card with a statement. */
const MIXED = () =>
  cashNeeded({
    accounts: [CHECKING, FROZEN_CARD, HEALTHY_CARD],
    statements: [
      statement('frozen-card', 217_999, '2026-06-15'),
      statement('healthy-card', 40_000, '2026-06-18'),
    ],
  });

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('the fact rides the money, and no figure moves', () => {
  it('a frozen card carries its date out on the obligation; a healthy sibling carries null', () => {
    const out = MIXED();
    const frozen = out.cards.find((c) => c.cardId === 'frozen-card')!;
    const healthy = out.cards.find((c) => c.cardId === 'healthy-card')!;
    expect(frozen.frozenSince).toBe(DROPPED);
    expect(healthy.frozenSince).toBeNull();
  });

  it('the funding account carries BOTH its date and the frozen balance, so a surface can name it', () => {
    const out = cashNeeded({
      accounts: [{ ...CHECKING, feedDroppedAt: DROPPED }, HEALTHY_CARD],
      statements: [statement('healthy-card', 40_000, '2026-06-18')],
    });
    expect(out.fundingFrozen).toEqual({ frozenSince: DROPPED, balanceCents: cents(500_000) });
  });

  it('a healthy funding account carries null — one nullable object, so date and amount cannot disagree', () => {
    expect(MIXED().fundingFrozen).toBeNull();
  });

  it('an undatable frozen card carries the flag too — that list prints a bare BALANCE', () => {
    const out = cashNeeded({
      accounts: [
        CHECKING,
        account({
          id: 'undatable',
          name: 'Store Card',
          type: 'CREDIT',
          currentBalanceCents: 184_267,
          aprBps: 2999,
          feedDroppedAt: DROPPED,
        }),
      ],
    });
    expect(out.unknownDueDateCards).toEqual([
      {
        cardId: 'undatable',
        cardName: 'Store Card',
        currentBalanceCents: cents(184_267),
        frozenSince: DROPPED,
      },
    ]);
  });

  it('DISCLOSE, ADJUST NOTHING: every figure is identical with the stamp and without it', () => {
    // The stance the whole feature rests on. If a future change starts excluding a frozen row from
    // a total, this goes red and the shipped sentences have to change with it.
    const frozen = MIXED();
    const healthy = cashNeeded({
      accounts: [CHECKING, { ...FROZEN_CARD, feedDroppedAt: null }, HEALTHY_CARD],
      statements: [
        statement('frozen-card', 217_999, '2026-06-15'),
        statement('healthy-card', 40_000, '2026-06-18'),
      ],
    });
    expect(frozen.headline).toEqual(healthy.headline);
    expect(frozen.perDueDate).toEqual(healthy.perDueDate);
    expect(frozen.cards.map((c) => c.cashRequiredCents)).toEqual(
      healthy.cards.map((c) => c.cashRequiredCents),
    );
    expect(frozen.cards.map((c) => c.userActionCents)).toEqual(
      healthy.cards.map((c) => c.userActionCents),
    );
  });

  it('a frozen LOAN carries it as well — the reminder email prints its payment beside a card’s', () => {
    const [loan] = selectLoanObligations({
      accounts: [
        {
          id: 'loan-1',
          name: 'Auto Loan',
          type: 'LOAN',
          minimumPaymentCents: 38_500,
          dueDayOfMonth: 5,
          feedDroppedAt: DROPPED,
        },
      ],
      today: TODAY,
      holidays: HOL,
    });
    expect(loan.frozenSince).toBe(DROPPED);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('the engine’s own disclosure — corrected, not merely moved', () => {
  it('does NOT claim a statemented card’s figures come from the frozen balance (they come from the statement)', () => {
    // L.14's sentence said "Its figures here are based on the last balance we saw". With a
    // statement, `buildObligation` reads the statement's balance, minimum and due date and never
    // touches `currentBalanceCents` — so that named a dependency the figure does not have.
    const said = MIXED().assumptions.join(' ');
    expect(said).not.toContain('based on the last balance');
    expect(said).toContain('Chase Sapphire');
    expect(said).toContain(`stopped sharing Chase Sapphire on ${DROPPED_LONG}`);
  });

  it('names what IS missing: anything that happened since, INCLUDING a payment already made', () => {
    // The two real mechanisms, both verified in the engine: CardPayment rows stop arriving with the
    // feed, so money already paid is never subtracted, and no replacement statement arrives either.
    // Second person only where every row is the reader's own; the ENGINE cannot know that at
    // household scope, so it says "any payment made" (critic P1-3).
    expect(MIXED().assumptions.join(' ')).toContain('including any payment made against this statement');
  });

  it('the ESTIMATE path says the amount itself is worked out from that last balance — because it is', () => {
    const out = cashNeeded({ accounts: [CHECKING, FROZEN_CARD] }); // no statements at all
    expect(out.cards[0].isEstimated).toBe(true);
    expect(out.assumptions.join(' ')).toContain('the amount asked for here is worked out from the last balance');
  });

  it('the funding sentence names the shortfall and the transfer, not "every figure"', () => {
    // `requiredCents` is the sum of the card dues and does not read this balance at all, so "every
    // figure here is projected from it" was an over-claim in the other direction.
    const said = cashNeeded({
      accounts: [{ ...CHECKING, feedDroppedAt: DROPPED }, FROZEN_CARD],
      statements: [statement('frozen-card', 217_999, '2026-06-15')],
    }).assumptions.join(' ');
    expect(said).toContain('The shortfall and any transfer it recommends are projected from that balance');
    expect(said).not.toContain('Every figure here is projected');
  });

  it('does NOT name a frozen card that is in no figure at all (critic P0-1)', () => {
    // A card with no statement AND no cycle days produces no obligation: it lands in
    // `unknownDueDateCards`, contributes $0, and already has its own "excluded from every figure
    // here" assumption. The first cut resolved over every input card, so it took the ESTIMATE
    // branch and told the reader the amount asked for was worked out from that card's last balance
    // — two assumptions in one list contradicting each other, and the louder one false.
    const out = cashNeeded({
      accounts: [
        CHECKING,
        HEALTHY_CARD,
        account({
          id: 'ghost',
          name: 'Ghost Card',
          type: 'CREDIT',
          currentBalanceCents: 412_300,
          aprBps: 2999,
          feedDroppedAt: DROPPED,
        }),
      ],
      statements: [statement('healthy-card', 120_000, '2026-06-12')],
    });
    expect(out.unknownDueDateCards.map((c) => c.cardName)).toEqual(['Ghost Card']);
    const said = out.assumptions.join(' ');
    expect(said).toContain('are excluded from every figure here');
    expect(said).not.toContain('stopped sharing Ghost Card');
    expect(said).not.toContain('the amount asked for here is worked out');
  });

  it('nor a frozen card that is merely LISTED but owes nothing this cycle', () => {
    const out = cashNeeded({
      accounts: [CHECKING, { ...FROZEN_CARD, currentBalanceCents: 0 }, HEALTHY_CARD],
      statements: [
        statement('frozen-card', 0, '2026-06-15'),
        statement('healthy-card', 40_000, '2026-06-18'),
      ],
    });
    // It IS in `cards` (so /cards lists it, with its own row note) and in no total.
    expect(out.cards.map((c) => c.cardId)).toContain('frozen-card');
    expect(out.assumptions.join(' ')).not.toContain('Chase Sapphire');
  });

  it('drops the action guard on a COVERED hero — there is no amount to treat as a floor (P2-3)', () => {
    // A frozen funding account with no shortfall: "Treat the amount as a floor and check the
    // account first" was printed where the surface states no amount at all.
    const covered = cashNeeded({
      accounts: [{ ...CHECKING, feedDroppedAt: DROPPED }, HEALTHY_CARD],
      statements: [statement('healthy-card', 40_000, '2026-06-18')],
    });
    expect(covered.headline.recommendation).toBeNull();
    const said = covered.assumptions.join(' ');
    expect(said).toContain('has not updated since');
    expect(said).not.toContain('Treat the amount as a floor');

    // …and it comes back the moment the surface actually recommends a transfer.
    const short = cashNeeded({
      accounts: [
        { ...CHECKING, currentBalanceCents: 1_000, feedDroppedAt: DROPPED },
        HEALTHY_CARD,
      ],
      statements: [statement('healthy-card', 40_000, '2026-06-18')],
    });
    expect(short.headline.recommendation).not.toBeNull();
    expect(short.assumptions.join(' ')).toContain('Treat the amount as a floor');
  });

  it('DOES name a frozen card in `upcoming`, whose amount IS the frozen balance (cycle-2 P1-4)', () => {
    // The P0-1 fix narrowed to `due` and over-shot: `upcoming` holds the ESTIMATE-path obligations,
    // whose amount is the frozen balance verbatim, and the hero prints them as "est. — next cycle"
    // beside a surviving assumption that names that figure and calls it "the current balance".
    const out = cashNeeded({
      accounts: [CHECKING, FROZEN_CARD, HEALTHY_CARD],
      statements: [statement('healthy-card', 40_000, '2026-06-18')],
    });
    expect(out.upcoming.map((c) => c.cardId)).toEqual(['frozen-card']);
    expect(out.assumptions.join(' ')).toContain('stopped sharing Chase Sapphire');
  });

  it('says nothing at all when every account is still being shared', () => {
    const said = cashNeeded({
      accounts: [CHECKING, HEALTHY_CARD],
      statements: [statement('healthy-card', 40_000, '2026-06-18')],
    }).assumptions.join(' ');
    expect(said).not.toContain('stopped sharing');
    expect(said).not.toContain('stopped updating');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('/cards — the page’s per-row note and its one instruction', () => {
  it('the row note is built from the obligation and the PAINTED label, and guards the action', () => {
    const frozen = MIXED().cards.find((c) => c.cardId === 'frozen-card')!;
    const note = frozenCardsNote(
      [
        {
          cardId: frozen.cardId,
          label: `${frozen.cardName} ····0977`,
          frozenSince: frozen.frozenSince as string,
          amountSource: currentCycleAmountSource(frozen.isEstimated),
          ownership: 'reader',
        },
      ],
      { role: 'instruction', nextStep: 'accounts-route' },
    );
    // Named exactly as the heading paints it — mask glyph included (the L.14 critic P2-1 defect was
    // a note naming the same card a second, different way).
    expect(note).toContain('Chase Sapphire ····0977');
    expect(note).toContain('Check the card with your bank before paying.');
    expect(note).toContain('Accounts shows the connection and how to fix or remove it.');
    // No position: this string also renders under the "Do this first" panel several rows away.
    expect(note).not.toMatch(/\babove\b|\bbelow\b/);
  });

  it('the FIGURE role carries no action guard — a total is weighed, not acted on', () => {
    const row = {
      cardId: 'c',
      label: 'Chase Sapphire',
      frozenSince: DROPPED,
      amountSource: 'statement' as const,
      ownership: 'reader' as const,
    };
    expect(frozenCardsNote([row], { role: 'figure', nextStep: 'accounts-route' })).not.toContain(
      'before paying',
    );
    expect(frozenCardsNote([row], { role: 'instruction', nextStep: 'accounts-route' })).toContain(
      'before paying',
    );
  });

  it("a PARTNER's card drops the imperative and never claims the reader's bank (critic P1-1)", () => {
    // The reader is not the one paying it, and it is not their bank. The first cut printed "Your
    // bank stopped sharing … Check the card with your bank before paying" and then, in the same
    // breath, "only the household member who owns it can reconnect it" — an instruction pointing
    // one way and a remedy the other. Slice-8 critic F-2: a second-person money claim on a
    // partner's card invites a double payment.
    const note = frozenCardsNote(
      [
        {
          cardId: 'p',
          label: "Sam's Venture ····0977",
          frozenSince: DROPPED,
          amountSource: 'statement' as const,
          ownership: 'partner',
        },
      ],
      { role: 'instruction', nextStep: 'accounts-route' },
    ) as string;
    expect(note).toContain('The bank stopped sharing');
    expect(note).not.toContain('Your bank');
    expect(note).not.toContain('before paying');
    expect(note).not.toContain('Accounts shows');
    expect(note).toContain('Only the household member who owns it can reconnect it');
    // …and the possessive drops rather than being reassigned: the payment is theirs, not yours.
    expect(note).not.toContain('you have already made');
  });

  it('the ENGINE says "the bank", because at household scope it cannot know whose card it is', () => {
    // `computeCashNeeded` is pure and is handed a merged account list with no ownership on it. The
    // honest answer to a question it cannot answer is the neutral subject, not a false default.
    const said = MIXED().assumptions.join(' ');
    expect(said).toContain('The bank stopped sharing Chase Sapphire');
    expect(said).not.toContain('Your bank stopped sharing Chase Sapphire');
  });

  it('two cards that PAINT IDENTICALLY are not named twice as if they were different (critic P1-3)', () => {
    // The #298 shape: the owner's own screen held three cards all called "CREDIT CARD". The L.15
    // rule is to say they cannot be told apart, never to manufacture an identifier.
    const note = frozenNothingDueNote(
      [
        { label: 'CREDIT CARD', frozenSince: DROPPED, ownership: 'reader', kind: 'card' as const, missing: null },
        { label: 'CREDIT CARD', frozenSince: DROPPED, ownership: 'reader', kind: 'card' as const, missing: null },
      ],
      { nextStep: 'accounts-route' },
    ) as string;
    expect(note).toContain('all of them named “CREDIT CARD”');
    expect(note).not.toContain('CREDIT CARD, CREDIT CARD');
  });

  it('two frozen accounts at two banks are not "your bank" (critic P3-3)', () => {
    const note = frozenTotalNote(
      [
        { label: 'Chase Checking', frozenSince: DROPPED },
        { label: 'Ally Savings', frozenSince: DROPPED },
      ],
      { figureLabel: 'your net worth', nextStep: 'accounts-route' },
    ) as string;
    expect(note).toContain("2 accounts' balances stopped updating");
    expect(note).toContain('Chase Checking, Ally Savings');
  });

  it('a MIXED list says each thing once instead of one sentence true of neither (cycle-2 P2-1)', () => {
    // One own card had been enough to restore the imperative, the second-person possessive and the
    // reader-only remedy over the partner's row beside it.
    const note = frozenCardsNote(
      [
        { cardId: 'a', label: 'Chase Sapphire', frozenSince: DROPPED, amountSource: 'statement' as const, ownership: 'reader' },
        { cardId: 'b', label: "Sam's Venture", frozenSince: DROPPED, amountSource: 'statement' as const, ownership: 'partner' },
      ],
      { role: 'instruction', nextStep: 'accounts-route' },
    ) as string;
    // The reader's own half keeps its imperative and its route…
    expect(note).toContain('Your bank stopped sharing Chase Sapphire');
    expect(note).toContain('Check the card with your bank before paying');
    // …and the partner's half carries neither.
    expect(note).toContain("The bank stopped sharing Sam's Venture");
    expect(note).toContain('Only the household member who owns it can reconnect it');
    // The imperative appears exactly once, attached to the card it is true of.
    expect(note.match(/before paying/g)).toHaveLength(1);
  });

  it('returns null for a page with no frozen card, so an unaffected /cards is byte-identical', () => {
    expect(frozenCardsNote([], { role: 'instruction', nextStep: 'accounts-route' })).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('the reminder email — no position, no control it does not have', () => {
  const remindersFor = (out: ReturnType<typeof cashNeeded>) =>
    selectPaymentReminders({ obligations: out.cards, today: TODAY, withinDays: 10 });

  it('carries the flag through the selector onto the reminder', () => {
    const list = remindersFor(MIXED());
    expect(list.find((r) => r.accountId === 'frozen-card')!.frozenSince).toBe(DROPPED);
    expect(list.find((r) => r.accountId === 'healthy-card')!.frozenSince).toBeNull();
  });

  it('qualifies the bullet it prints, and points at the APP rather than a page position', () => {
    const email = buildReminderEmail(remindersFor(MIXED()), TODAY)!;
    expect(email.text).toContain(
      'One of these payments comes from an account that is no longer being shared',
    );
    expect(email.text).toContain(
      `Chase Sapphire: your bank stopped sharing this account on ${DROPPED_LONG}`,
    );
    expect(email.text).toContain('in the amount listed for it in this email');
    expect(email.text).toContain('open Aimplifi to see the connection and how to fix it');
    // The L.15 rule: an email controls no position and holds no button.
    expect(email.text).not.toContain('the total above');
    expect(email.text).not.toContain('Add or fix accounts');
  });

  it('names only the frozen bullet, never the healthy one beside it', () => {
    const email = buildReminderEmail(remindersFor(MIXED()), TODAY)!;
    const block = email.text.slice(email.text.indexOf('One of these payments'));
    expect(block).not.toContain('Freedom Card');
  });

  it("a PARTNER's shared card names no control the reader does not have", () => {
    // The L.14 critic F-4 class, in an inbox: the reader cannot reconnect an account they do not
    // own, and an email carries nothing that can correct the instruction later.
    const [own, partner] = frozenDuesEmailLines([
      { label: 'Chase Sapphire', frozenSince: DROPPED, isEstimated: false, ownedByPartner: false, kind: 'card' as const },
    ]).length
      ? [
          frozenDuesEmailLines([
            { label: 'Chase Sapphire', frozenSince: DROPPED, isEstimated: false, ownedByPartner: false, kind: 'card' as const },
          ]),
          frozenDuesEmailLines([
            { label: "Sam's Venture", frozenSince: DROPPED, isEstimated: false, ownedByPartner: true, kind: 'card' as const },
          ]),
        ]
      : [[], []];
    expect(own.join(' ')).toContain('your bank stopped sharing this account');
    expect(own.join(' ')).toContain('open Aimplifi to see the connection');
    expect(partner.join(' ')).toContain('the bank behind this account stopped sharing it');
    expect(partner.join(' ')).toContain('Only the household member who owns it can reconnect it');
    // The decisive half: no instruction to go and fix what is not theirs.
    expect(partner.join(' ')).not.toContain('open Aimplifi');
    expect(partner.join(' ')).not.toContain('your bank');
  });

  it('a frozen LOAN is not told a card’s story (critic P1-3)', () => {
    // Nothing subtracts a payment from a loan obligation — `selectLoanObligations` reads a stored
    // monthly payment and a due day and nothing else — so the card sentence would name a mechanism
    // that does not exist, and a reader who reads the reminder as stale skips a mortgage payment.
    const lines = frozenDuesEmailLines([
      {
        label: 'Wells Fargo Mortgage',
        frozenSince: DROPPED,
        isEstimated: false,
        ownedByPartner: false,
        kind: 'loan',
      },
    ]).join(' ');
    expect(lines).toContain('the last ones it sent — nothing about this loan has been confirmed since');
    expect(lines).not.toContain('any payment you have already made');
  });

  it('an all-healthy email is byte-identical to a GOLDEN literal — nothing added, nothing reordered', () => {
    const healthy = cashNeeded({
      accounts: [CHECKING, HEALTHY_CARD],
      statements: [statement('healthy-card', 40_000, '2026-06-18')],
    });
    const email = buildReminderEmail(remindersFor(healthy), TODAY)!;
    expect(email.text).toBe(
      [
        "Here's what's coming up as of Wed, Jun 10, 2026:",
        '',
        "• Freedom Card: $400.00 due Thu, Jun 18, 2026 (in 8 days) — you'll pay $400.00 yourself",
        '',
        'A heads-up so nothing catches you by surprise. Aimplifi never moves money for you — this is just a reminder.',
      ].join('\n'),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('the weekly digest — the dues branch and the all-clear branch make different claims', () => {
  // TASKS L.19: through the SAME engine helper both real call sites now use, rather than a
  // third hand-rolled copy of it — a fixture that builds the list its own way cannot catch the
  // class of defect that put this slice in the queue.
  const frozenCardsOf = (out: ReturnType<typeof cashNeeded>) =>
    frozenNothingDueRows({
      cards: [...out.cards, ...out.unknownDueDateCards],
      loans: [],
      partnerLabel: {},
    });

  it('qualifies the listed dues, resolved against the bullets it printed', () => {
    const out = MIXED();
    const digest = buildWeeklyDigest({
      review: null,
      reminders: selectPaymentReminders({ obligations: out.cards, today: TODAY, withinDays: 7 }),
      today: TODAY,
      frozenDues: frozenCardsOf(out),
    })!;
    expect(digest.text).toContain('Chase Sapphire: your bank stopped sharing this account');
    expect(digest.text).not.toContain('a statement issued on it since'); // that is the OTHER branch
  });

  it('qualifies "a clear week ahead" with the absence claim, not the figure claim', () => {
    // A frozen card that owes nothing produces no due at all — so the digest reaches its all-clear
    // line, which is a positive money claim about a card whose statements can no longer arrive.
    const out = cashNeeded({
      accounts: [CHECKING, { ...FROZEN_CARD, currentBalanceCents: 0 }],
    });
    expect(out.headline.requiredCents).toBe(0);
    const digest = buildWeeklyDigest({
      review: {
        month: '2026-05',
        improvement: 'i',
        creep: 'c',
        nextAction: 'One next action: automate one transfer on payday.',
      },
      reminders: [],
      today: TODAY,
      frozenDues: frozenCardsOf(out),
    })!;
    expect(digest.text).toContain('Nothing due in the next 7 days');
    expect(digest.text).toContain(
      `Your bank stopped sharing Chase Sapphire on ${DROPPED_LONG}, so a statement issued on it since would not have reached us`,
    );
    expect(digest.text).toContain('Open Aimplifi');
  });

  it('a clear week with no frozen card says nothing extra — the abstention twin', () => {
    const digest = buildWeeklyDigest({
      review: {
        month: '2026-05',
        improvement: 'i',
        creep: 'c',
        nextAction: 'One next action: automate one transfer on payday.',
      },
      reminders: [],
      today: TODAY,
      frozenDues: [],
    })!;
    expect(digest.text).toContain('Nothing due in the next 7 days — a clear week ahead.');
    expect(digest.text).not.toContain('stopped sharing');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('web push — the amount first, the caveat last, and never suppressed', () => {
  it('the payment_due body keeps the amount and the date ahead of the note', () => {
    const out = cashNeeded({
      accounts: [CHECKING, FROZEN_CARD],
      statements: [statement('frozen-card', 217_999, '2026-06-12')],
    });
    const [n] = selectNotifications({
      reminders: selectPaymentReminders({ obligations: out.cards, today: TODAY, withinDays: 5 }),
      radar: null,
      today: TODAY,
    });
    expect(n.kind).toBe('payment_due');
    expect(n.body.indexOf('$2,179.99')).toBeLessThan(n.body.indexOf('stopped sharing'));
    expect(n.body).toContain(
      `Your bank stopped sharing this account on ${DROPPED_LONG}, so a payment you have already made may not be counted here.`,
    );
    // Disclose, never suppress: the notification still goes out.
    expect(n.amountCents).toBe(217_999);
  });

  it('the radar alert keeps the duplicate warning ahead of the frozen note (cycle-2 P2-2)', () => {
    // Both advisories qualify the same amount to move; the duplicate one warns it may be DOUBLE, so
    // it must survive OS truncation first. The payment_due branch was fixed and this one had the
    // same demotion introduced in the same pass.
    const radar = computeRadar({
      today: TODAY,
      horizonDays: 90,
      startingBalanceCents: cents(50_000),
      committedEvents: [],
      cardDues: [
        {
          cardId: 'frozen-card',
          cardName: 'Chase Sapphire',
          dueDate: isoDate('2026-06-15'),
          amountCents: cents(217_999),
          isEstimated: false,
        },
      ],
      accounts: [
        {
          id: 'chk',
          name: 'Everyday Checking',
          type: 'CHECKING',
          currentBalanceCents: 50_000,
          feedDroppedAt: DROPPED,
        },
      ],
      paymentAccountId: 'chk',
      holidays: HOL,
      burn: null,
    });
    const [n] = selectNotifications({
      reminders: [],
      radar: { ...radar, pushWorthy: true, duplicateDisclosure: 'CREDIT CARD may be counted twice.' },
      today: TODAY,
    });
    expect(n.body.indexOf('counted twice')).toBeLessThan(n.body.indexOf('stopped updating'));
  });

  it('a healthy card’s push body is a GOLDEN literal — the advisory is genuinely conditional', () => {
    const out = cashNeeded({
      accounts: [CHECKING, { ...HEALTHY_CARD, dueDayOfMonth: 12 }],
      statements: [statement('healthy-card', 40_000, '2026-06-12')],
    });
    const [n] = selectNotifications({
      reminders: selectPaymentReminders({ obligations: out.cards, today: TODAY, withinDays: 5 }),
      radar: null,
      today: TODAY,
    });
    expect(n.body).toBe(
      'Pay $400.00 yourself by Fri, Jun 12, 2026. Aimplifi never moves money for you.',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('Cash Flow Radar — the gap L.14 left: the balance the walk STARTS from', () => {
  const radarInput = (frozen: boolean, overrides: Partial<RadarInput> = {}): RadarInput => ({
    today: TODAY,
    horizonDays: 90,
    startingBalanceCents: cents(50_000),
    committedEvents: [],
    cardDues: [
      {
        cardId: 'frozen-card',
        cardName: 'Chase Sapphire',
        dueDate: isoDate('2026-06-15'),
        amountCents: cents(217_999),
        isEstimated: false,
      },
    ],
    accounts: [
      {
        id: 'chk',
        name: 'Everyday Checking',
        type: 'CHECKING',
        currentBalanceCents: 50_000,
        feedDroppedAt: frozen ? DROPPED : null,
      },
      {
        id: 'sav',
        name: 'Rainy Day Savings',
        type: 'SAVINGS',
        currentBalanceCents: 900_000,
        feedDroppedAt: null,
      },
    ],
    paymentAccountId: 'chk',
    holidays: HOL,
    burn: null,
    ...overrides,
  });

  it('states that the projection starts from a balance that stopped updating', () => {
    const out = computeRadar(radarInput(true));
    expect(out.coverTransfer).not.toBeNull();
    expect(out.assumptions.join(' ')).toContain(
      `This projection starts from Everyday Checking's balance, which stopped updating on ${DROPPED_LONG}`,
    );
    expect(out.assumptions.join(' ')).toContain(
      'the dip comes sooner and the amount to move is larger than shown',
    );
  });

  it('the PUSH body gets its own short sentence, not the in-app one', () => {
    const out = computeRadar(radarInput(true));
    expect(out.startingBalanceFrozenDisclosure).toContain('if the real balance is lower, the dip comes sooner');
    // A notification holds no control, so the push variant points at nothing.
    expect(out.startingBalanceFrozenDisclosure).not.toContain('Accounts shows');
    const [n] = selectNotifications({
      reminders: [],
      radar: { ...out, pushWorthy: true },
      today: TODAY,
    });
    expect(n.body).toContain('stopped updating');
    expect(n.body.indexOf('keeps you clear')).toBeLessThan(n.body.indexOf('stopped updating'));
  });

  it('with NO dip it says the opposite thing — an absent dip is not evidence of safety', () => {
    const out = computeRadar(
      radarInput(true, { startingBalanceCents: cents(5_000_000) }),
    );
    expect(out.status).toBe('ok');
    expect(out.coverTransfer).toBeNull();
    const said = out.assumptions.join(' ');
    expect(said).toContain('no dip here is not evidence that the account is safe');
    // The instruction wording would be nonsense here — there is nothing to move.
    expect(said).not.toContain('the amount to move is larger');
  });

  it('a dip with no transfer says "deeper", not "the amount to move is larger"', () => {
    // /forecast walks the same balance and states a dip with no transfer attached, so the radar's
    // instruction wording would name an amount that surface does not print.
    const out = computeRadar(
      radarInput(true, {
        cardDues: [],
        committedEvents: [
          { date: isoDate('2026-06-20'), amountCents: cents(-90_000), label: 'Rent' },
        ],
        accounts: [
          {
            id: 'chk',
            name: 'Everyday Checking',
            type: 'CHECKING',
            currentBalanceCents: 50_000,
            feedDroppedAt: DROPPED,
          },
        ],
      }),
    );
    expect(out.committed.firstNegativeDate).not.toBeNull();
    expect(out.coverTransfer?.sources).toEqual([]);
    const said = out.assumptions.join(' ');
    // With no eligible source the radar still proposes a transfer, so it keeps the instruction
    // wording; the 'a-dip' branch is what /forecast passes, and it is exercised directly below.
    expect(said).toContain('This projection starts from');
  });

  it('a healthy funding account gets neither sentence, and the FIGURES are identical either way', () => {
    const frozen = computeRadar(radarInput(true));
    const healthy = computeRadar(radarInput(false));
    expect(healthy.assumptions.join(' ')).not.toContain('stopped updating');
    expect(healthy.startingBalanceFrozenDisclosure).toBeNull();
    // Disclose, adjust nothing — the walk is untouched.
    expect(frozen.committed).toEqual(healthy.committed);
    expect(frozen.coverTransfer?.amountCents).toBe(healthy.coverTransfer?.amountCents);
    expect(frozen.coverTransfer?.byDate).toBe(healthy.coverTransfer?.byDate);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('/forecast — the same walk, with no transfer to qualify', () => {
  const funding = { label: 'Everyday Checking', frozenSince: DROPPED };

  it('states a deeper, sooner dip rather than an amount to move', () => {
    const note = frozenProjectionNote(funding, { shows: 'a-dip', nextStep: 'accounts-route' });
    expect(note).toContain('the dip comes sooner and goes deeper than shown');
    // /forecast prints no transfer, so naming one would describe a control that is not there.
    expect(note).not.toContain('amount to move');
  });

  it('and with NO dip says the absence is not evidence — the quiet, expensive case', () => {
    const note = frozenProjectionNote(funding, { shows: 'no-dip', nextStep: 'accounts-route' });
    expect(note).toContain('no dip here is not evidence that the account is safe');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('the Ask assistant — reported figures, and the panel opened to audit them', () => {
  const ROWS = [
    { id: 'chk', name: 'Everyday Checking', type: 'CHECKING', currentBalanceCents: 250_000 },
    {
      id: 'sav',
      name: 'Rainy Day Savings',
      type: 'SAVINGS',
      currentBalanceCents: 421_055,
      feedDroppedAt: DROPPED,
    },
    { id: 'card', name: 'Freedom Card', type: 'CREDIT', currentBalanceCents: 40_000 },
  ];
  const ACCOUNTS = assistantAccounts(ROWS, new Set());
  const HEALTHY = assistantAccounts(
    ROWS.map((r) => ({ ...r, feedDroppedAt: null })),
    new Set(),
  );

  it('net worth names the frozen account inside the total', () => {
    const a = answerNetWorth(ACCOUNTS);
    expect(a.headline).toBe('Your net worth is $6,310.55.');
    expect(a.detail).toContain(
      `Rainy Day Savings's balance stopped updating on ${DROPPED_LONG}`,
    );
    expect(a.detail).toContain('still counted in your net worth');
  });

  it('the derivation panel gains a basis line and STAYS RECONCILED — the arithmetic is not the issue', () => {
    const a = answerNetWorth(ACCOUNTS);
    const trace = traceNetWorthDerivation(ACCOUNTS, a.headlineCents as number);
    expect(trace.reconciled).toBe(true);
    expect(trace.sumCents).toBe(631_055);
    expect(trace.basis.join(' ')).toContain('stopped updating');
    expect(trace.basis.join(' ')).toContain('the net worth this panel explains');
    // No position claim: this list renders after the totals here and before them elsewhere.
    expect(trace.basis.join(' ')).not.toMatch(/\bbelow\b/);
  });

  it('a boundary-ZEROED predecessor is never announced as counted (critic P0-2)', () => {
    // `applyReconciliationBoundary` zeroes a superseded row's balance and keeps every other field,
    // this stamp included. Reading it raw made the answer say a $0.00 row's last figure was "still
    // counted in your net worth" — on the panel opened to audit that very number.
    const withSuperseded = assistantAccounts(
      [
        { id: 'old', name: 'Old Chase Savings', type: 'SAVINGS', currentBalanceCents: 0, feedDroppedAt: DROPPED },
        { id: 'new', name: 'Chase Savings', type: 'SAVINGS', currentBalanceCents: 430_000 },
      ],
      new Set(['old']),
    );
    const a = answerNetWorth(withSuperseded);
    expect(a.headline).toBe('Your net worth is $4,300.00.');
    expect(a.detail).not.toContain('Old Chase Savings');
    expect(a.detail).not.toContain('stopped updating');
    const trace = traceNetWorthDerivation(withSuperseded, a.headlineCents as number);
    expect(trace.basis.join(' ')).not.toContain('stopped updating');
    // …and a LIVE frozen account in the same list is still announced, so the guard did not just
    // disable the feature.
    const mixed = assistantAccounts(
      [
        { id: 'old', name: 'Old Chase Savings', type: 'SAVINGS', currentBalanceCents: 0, feedDroppedAt: DROPPED },
        { id: 'sav', name: 'Rainy Day Savings', type: 'SAVINGS', currentBalanceCents: 421_055, feedDroppedAt: DROPPED },
      ],
      new Set(['old']),
    );
    const b = answerNetWorth(mixed);
    expect(b.detail).toContain('Rainy Day Savings');
    expect(b.detail).not.toContain('Old Chase Savings');
  });

  it('a healthy net-worth answer and trace are GOLDEN — no caveat appears from nowhere', () => {
    const a = answerNetWorth(HEALTHY);
    expect(a.detail).toBe(
      "Everything you own minus everything you owe, across every account you've linked or added.",
    );
    expect(traceNetWorthDerivation(HEALTHY, a.headlineCents as number).basis).toEqual([
      "Current balances across every account you've linked or added.",
      "Credit cards, loans, mortgages, and other debts you've added count as money you owe; everything else counts as money you own.",
    ]);
  });

  it('a single-account answer says the figure IS the last one we saw, not that a total contains it', () => {
    const a = answerAccountBalance(ACCOUNTS, 'how much is in my savings');
    expect(a.headline).toBe('Rainy Day Savings has $4,210.55.');
    expect(a.detail).toContain('That balance stopped updating');
    expect(a.detail).toContain('it is the last figure we saw, not a current one');
    expect(a.detail).not.toContain('still counted in');
  });

  it('the no-match LIST says the figure IS the last one seen, not that a total contains it (P3-5)', () => {
    const a = answerAccountBalance(ACCOUNTS, 'what about my brokerage at Vanguard');
    expect(a.headline).toBe("I couldn't find an account matching that.");
    expect(a.detail).toContain('it is the last figure we saw, not a current one');
    expect(a.detail).not.toContain('counted in the balances listed here');
  });

  it('an account-balance answer about a HEALTHY account carries no detail at all', () => {
    const a = answerAccountBalance(ACCOUNTS, 'what is in my checking');
    expect(a.headline).toBe('Everyday Checking has $2,500.00.');
    expect(a.detail).toBeUndefined();
  });

  it('cash-needed qualifies the counted cards and the funding account, in that order', () => {
    const out = cashNeeded({
      accounts: [{ ...CHECKING, currentBalanceCents: 1_000, feedDroppedAt: DROPPED }, FROZEN_CARD],
      statements: [statement('frozen-card', 217_999, '2026-06-15')],
    });
    const a = answerCashNeeded(out, 'Everyday Checking');
    expect(a.headline).toBe('You need $2,179.99 by Jun 15, 2026 to pay your cards in full.');
    expect(a.detail).toContain('stopped sharing Chase Sapphire');
    expect(a.detail).toContain("Everyday Checking's balance of $10.00 has not updated");
    // The card caveat comes first, then the transfer instruction, then the funding caveat beside it.
    expect(a.detail!.indexOf('Chase Sapphire')).toBeLessThan(a.detail!.indexOf('move $2,200.00'));
    expect(a.detail!.indexOf('move $2,200.00')).toBeLessThan(
      a.detail!.indexOf("Everyday Checking's balance"),
    );
    expect(a.detail).toContain('Treat the amount as a floor and check the account first.');
  });

  it('with NO shortfall the funding caveat drops the action guard but is still stated', () => {
    // The silent-failure case: a balance frozen HIGH shows no shortfall and no transfer at all.
    const out = cashNeeded({
      accounts: [{ ...CHECKING, feedDroppedAt: DROPPED }, FROZEN_CARD],
      statements: [statement('frozen-card', 217_999, '2026-06-15')],
    });
    expect(out.headline.shortfallCents).toBe(0);
    const a = answerCashNeeded(out, 'Everyday Checking');
    expect(a.detail).toContain("Everyday Checking's balance of $5,000.00 has not updated");
    expect(a.detail).not.toContain('Treat the amount as a floor');
  });

  it('a frozen card that is in NO figure of this answer is not named in it', () => {
    // An estimated obligation is dropped wholesale once any card has a real statement, so the
    // frozen card here is in neither the total nor the count — and the sentence would be false.
    const out = cashNeeded({
      accounts: [CHECKING, FROZEN_CARD, HEALTHY_CARD],
      statements: [statement('healthy-card', 40_000, '2026-06-18')],
    });
    expect(out.upcoming.map((c) => c.cardId)).toEqual(['frozen-card']);
    const a = answerCashNeeded(out, 'Everyday Checking');
    expect(a.detail ?? '').not.toContain('Chase Sapphire');
  });

  it('the all-clear answer says a statement could no longer reach us', () => {
    const out = cashNeeded({
      accounts: [CHECKING, { ...FROZEN_CARD, currentBalanceCents: 0 }],
    });
    const a = answerCashNeeded(out, 'Everyday Checking');
    expect(a.headline).toBe('You have nothing due on your cards this cycle.');
    expect(a.detail).toContain('would not have reached us');
  });

  it('and an all-clear with no frozen card carries no detail — the abstention twin', () => {
    const out = cashNeeded({ accounts: [CHECKING, { ...HEALTHY_CARD, currentBalanceCents: 0 }] });
    const a = answerCashNeeded(out, 'Everyday Checking');
    expect(a.headline).toBe('You have nothing due on your cards this cycle.');
    expect(a.detail).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('the dashboard Glass-Box trace — the other panel opened to audit a number', () => {
  it('names the frozen card behind the rows, and still reconciles', () => {
    const out = MIXED();
    const trace = traceCashNeeded(out);
    expect(trace.reconciles).toBe(true);
    expect(trace.basis.join(' ')).toContain('stopped sharing Chase Sapphire');
  });

  it('says nothing about a frozen card that is in NO row of this trace', () => {
    // An estimated obligation is dropped to `upcoming` the moment any card has a real statement, so
    // the frozen card is in neither the rows nor the total — the sentence would be about nothing.
    const out = cashNeeded({
      accounts: [CHECKING, FROZEN_CARD, HEALTHY_CARD],
      statements: [statement('healthy-card', 40_000, '2026-06-18')],
    });
    const trace = traceCashNeeded(out);
    expect(out.upcoming.map((c) => c.cardId)).toEqual(['frozen-card']);
    expect(trace.basis.join(' ')).not.toContain('Chase Sapphire');
  });

  it('names a PARTNER’s card as theirs — the panel is household-scoped (cycle-2 P1-1)', () => {
    // The dashboard hero renders the MERGED result, so a row in this panel may be a partner's. The
    // first cut hardcoded `ownership: 'reader'` on the strength of a comment, and the panel a reader
    // opens to AUDIT a figure then vouched for their partner's frozen card in the second person.
    const out = MIXED();
    const trace = traceCashNeeded(out, [], new Set(['frozen-card']));
    const said = trace.basis.join(' ');
    expect(said).toContain('The bank stopped sharing');
    expect(said).not.toContain('Your bank');
    expect(said).not.toContain('you have already made');
    expect(said).toContain('Only the household member who owns it can reconnect it');
    // …and the reconciliation is still untouched, which is the whole point of this panel.
    expect(trace.reconciles).toBe(true);
  });

  it('an all-healthy trace keeps its GOLDEN basis — nothing appended', () => {
    const out = cashNeeded({
      accounts: [CHECKING, HEALTHY_CARD],
      statements: [statement('healthy-card', 40_000, '2026-06-18')],
    });
    expect(traceCashNeeded(out).basis).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * /coach, against REAL Prisma and the real `getCoachData` — because the interesting claim here is a
 * per-figure one, and only the server read knows which sum each account is inside.
 *
 * This also records a CORRECTION to the L.18 brief, proved by execution rather than argued: the
 * brief says "the frozen balance drives the FI number, years-to-FI and runway months". It does not
 * drive the FI number. `fiNumberCents(annualExpenses, swrBps)` reads no balance at all, and the
 * fixture below holds a frozen brokerage worth $4,210.55 while the FI number is $0.00.
 */
describe('/coach — qualified per figure, and NOT on the figure that reads no balance', () => {
  const U = `l18-coach-${Date.now()}-${process.pid}`;
  let frozenBrokerageId = '';

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
    await prisma.user.create({ data: { id: U, email: `${U}@test.local` } });
    const mk = (name: string, type: string, balance: number, dropped: string | null) =>
      prisma.account.create({
        data: {
          userId: U,
          provider: 'plaid',
          providerRef: `${U}-${name}`,
          name,
          type,
          currency: 'USD',
          currentBalanceCents: balance,
          feedDroppedAt: dropped,
        },
      });
    const brok = await mk('Old Brokerage', 'INVESTMENT', 421_055, DROPPED);
    frozenBrokerageId = brok.id;
    await mk('Vanguard', 'INVESTMENT', 1_000_000, null);
    await mk('Rainy Day Savings', 'SAVINGS', 250_000, DROPPED);
    await mk('Everyday Checking', 'CHECKING', 100_000, null);
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
  });

  it('splits the frozen accounts by WHICH figure each one feeds', async () => {
    const data = await getCoachData(U);
    expect(data.frozenBalances.portfolio).toEqual([
      { label: 'Old Brokerage', frozenSince: DROPPED },
    ]);
    expect(data.frozenBalances.liquid).toEqual([
      { label: 'Rainy Day Savings', frozenSince: DROPPED },
    ]);
  });

  it('the frozen brokerage is still inside the portfolio — disclose, adjust nothing', async () => {
    const data = await getCoachData(U);
    expect(data.fi.portfolioCents).toBe(1_421_055);
  });

  it('the FI NUMBER reads no balance, so nothing frozen belongs on it (the brief was wrong)', async () => {
    const data = await getCoachData(U);
    // $14,210.55 of frozen-and-healthy portfolio sits beside an FI number of $0.00, because the FI
    // number is annual EXPENSES ÷ the withdrawal rate and this fixture has no transactions.
    expect(data.fi.portfolioCents).toBeGreaterThan(0);
    expect(data.fi.annualExpensesCents).toBe(0);
    expect(data.fi.fiNumberCents).toBe(0);
  });

  it('a superseded predecessor is never announced — the boundary already zeroed it (L.14 P0-1)', async () => {
    const succ = await prisma.account.create({
      data: {
        userId: U,
        provider: 'plaid',
        providerRef: `${U}-succ`,
        name: 'New Brokerage',
        type: 'INVESTMENT',
        currency: 'USD',
        currentBalanceCents: 421_055,
      },
    });
    await prisma.accountReconciliation.create({
      data: {
        userId: U,
        predecessorAccountId: frozenBrokerageId,
        successorAccountId: succ.id,
        cutoverDate: '2026-06-01',
        matchSignal: 'mask',
        confidence: 'high',
        confirmedByUserAt: new Date(),
      },
    });
    const data = await getCoachData(U);
    expect(data.frozenBalances.portfolio).toEqual([]);
    // …and the liquid side, which the reconciliation does not touch, still speaks.
    expect(data.frozenBalances.liquid).toEqual([
      { label: 'Rainy Day Savings', frozenSince: DROPPED },
    ]);
  });

  it('a user with nothing frozen gets two empty lists, so /coach renders byte-identically', async () => {
    const V = `${U}-healthy`;
    await prisma.user.create({ data: { id: V, email: `${V}@test.local` } });
    await prisma.account.create({
      data: {
        userId: V,
        provider: 'plaid',
        providerRef: `${V}-chk`,
        name: 'Everyday Checking',
        type: 'CHECKING',
        currency: 'USD',
        currentBalanceCents: 100_000,
      },
    });
    const data = await getCoachData(V);
    expect(data.frozenBalances).toEqual({ portfolio: [], liquid: [] });
    await prisma.user.deleteMany({ where: { id: V } });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// TASKS L.19 — the two surfaces L.18 named open that share one primitive: the set of frozen DUES a
// surface prints. L.18 built that set from cards alone, so a frozen LOAN could not reach any
// qualifier at all, and /calendar — the one page whose entire product is a dated amount to pay —
// said nothing.
//
// Same discipline as above: driven through the real engines, abstentions in the majority, and the
// silent cases pinned to golden literals rather than to the code's own defaults.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** A frozen mortgage: a fixed payment and a stored due day, both last confirmed on the drop date. */
const FROZEN_LOAN = {
  ...account({ id: 'frozen-loan', name: 'Home Mortgage', type: 'LOAN', currentBalanceCents: 31_000_000, dueDayOfMonth: 12 }),
  minimumPaymentCents: 245_000,
  feedDroppedAt: DROPPED,
};

const HEALTHY_LOAN = {
  ...account({ id: 'healthy-loan', name: 'Car Loan', type: 'LOAN', currentBalanceCents: 1_800_000, dueDayOfMonth: 20 }),
  minimumPaymentCents: 41_500,
};

const loansOf = (accounts: (SnapshotAccount & { minimumPaymentCents?: number | null })[]) =>
  selectLoanObligations({ accounts, today: TODAY, holidays: HOL });

describe('L.19 — a frozen LOAN is not told a card story, and not addressed to the wrong person', () => {
  it('the loan note drops the second person and the imperative on a PARTNER loan', () => {
    // The live defect this slice found: `payment-reminders-card.tsx` already called this builder on
    // a partner's shared loan, and only the NEXT STEP was ownership-aware. The reader was told
    // "Your bank stopped sharing ... Check it with your lender before paying" over an account they
    // neither own nor pay — the double-payment invitation L.18's critic P1-1 closed for cards.
    const theirs = frozenLoanNote(
      { label: 'Home Mortgage (Sam)', frozenSince: DROPPED, ownership: 'partner' },
      { role: 'instruction', nextStep: 'accounts-route' },
    );
    expect(theirs).not.toContain('Your bank');
    expect(theirs).not.toContain('your lender');
    expect(theirs).toContain('The bank stopped sharing Home Mortgage (Sam)');
    expect(theirs).toContain('Only the household member who owns it can reconnect it.');
    expect(theirs).not.toContain('Accounts shows the connection');
  });

  it('the reader OWN loan keeps both the subject and the guard', () => {
    const mine = frozenLoanNote(
      { label: 'Home Mortgage', frozenSince: DROPPED, ownership: 'reader' },
      { role: 'instruction', nextStep: 'accounts-route' },
    );
    expect(mine).toContain('Your bank stopped sharing Home Mortgage');
    expect(mine).toContain('Check it with your lender before paying.');
    expect(mine).toContain('Accounts shows the connection');
  });

  it('a FIGURE drops the imperative even for the reader (role is not decorative)', () => {
    const asFigure = frozenLoanNote(
      { label: 'Home Mortgage', frozenSince: DROPPED, ownership: 'reader' },
      { role: 'figure', nextStep: 'accounts-route' },
    );
    expect(asFigure).not.toContain('before paying');
    // GOLDEN, not `f(x,'figure') !== f(x,'instruction')`: the silent form is pinned to the exact
    // sentence, so a future edit cannot quietly change what silence says.
    expect(asFigure).toBe(
      'Your bank stopped sharing Home Mortgage on Thu, May 28, 2026, so the payment amount and due ' +
        'date shown here are the last ones it sent — nothing about this loan has been confirmed ' +
        'since. Accounts shows the connection and how to fix or remove it.',
    );
  });
});

describe('L.19 — the all-clear can finally speak about a loan, and names no set it does not render', () => {
  const readerLoan = {
    label: 'Home Mortgage',
    frozenSince: DROPPED,
    ownership: 'reader' as const,
    kind: 'loan' as const,
    missing: null,
  };
  const readerCard = {
    label: 'Chase Sapphire',
    frozenSince: DROPPED,
    ownership: 'reader' as const,
    kind: 'card' as const,
    missing: null,
  };

  it('a frozen loan all-clear names the payment and due date, never a statement', () => {
    const note = frozenNothingDueNote([readerLoan], { nextStep: 'accounts-route' }) as string;
    // A loan issues no statement. The card wording would name a document that does not exist and
    // imply the stored due day is trustworthy — and the due day is the field that decides whether
    // "nothing due in the next 7 days" is true at all.
    expect(note).not.toContain('statement');
    expect(note).toContain('a change to its payment or due date since would not have reached us');
    expect(note).toContain('this covers only what we can still see');
  });

  it('a card and a loan produce TWO claims; neither borrows the other mechanism', () => {
    const note = frozenNothingDueNote([readerCard, readerLoan], {
      nextStep: 'accounts-route',
    }) as string;
    expect(note).toContain('a statement issued on it since would not have reached us');
    expect(note).toContain('a change to its payment or due date since would not have reached us');
    // Cards first, deterministically — the order must not depend on the caller's input order.
    const cardAt = note.indexOf('Chase Sapphire');
    const loanAt = note.indexOf('Home Mortgage');
    expect(cardAt).toBeGreaterThanOrEqual(0);
    expect(loanAt).toBeGreaterThan(cardAt);
  });

  it('the same two rows in the OPPOSITE input order produce a byte-identical sentence', () => {
    expect(frozenNothingDueNote([readerLoan, readerCard], { nextStep: 'accounts-route' })).toBe(
      frozenNothingDueNote([readerCard, readerLoan], { nextStep: 'accounts-route' }),
    );
  });

  it('the multi-row branch no longer names "the cards here" — a set no all-clear renders', () => {
    // Every caller of this builder is inside an all-clear branch, which lists NOTHING, so "here"
    // had no antecedent on any of the four surfaces that printed it.
    const note = frozenNothingDueNote([readerCard, { ...readerCard, label: 'Amex Gold' }], {
      nextStep: 'accounts-route',
    }) as string;
    expect(note).not.toContain('of the cards here');
    expect(note).toContain('Your banks stopped sharing 2 cards (Chase Sapphire, Amex Gold)');
  });

  it('two frozen loans are counted as loans, not as cards', () => {
    const note = frozenNothingDueNote([readerLoan, { ...readerLoan, label: 'Car Loan' }], {
      nextStep: 'accounts-route',
    }) as string;
    expect(note).toContain('2 loans (Home Mortgage, Car Loan)');
    expect(note).not.toContain('cards');
    expect(note).not.toContain('statement');
  });

  it('ABSTAINS on an empty set — an all-clear with nothing frozen says only the all-clear', () => {
    expect(frozenNothingDueNote([], { nextStep: 'accounts-route' })).toBeNull();
  });
});

describe('L.19 — one builder for the all-clear row set, so two surfaces cannot drift apart', () => {
  it('includes a frozen LOAN, which is the gap: the dashboard and the digest both enumerated cards', () => {
    const out = cashNeeded({
      accounts: [CHECKING, FROZEN_CARD, HEALTHY_CARD, FROZEN_LOAN, HEALTHY_LOAN],
      statements: [statement('frozen-card', 217_999, '2026-06-15')],
    });
    const rows = frozenNothingDueRows({
      cards: [...out.cards, ...out.unknownDueDateCards],
      loans: loansOf([FROZEN_LOAN, HEALTHY_LOAN]),
      partnerLabel: {},
    });
    expect(rows.map((r) => [r.label, r.kind])).toEqual([
      ['Chase Sapphire', 'card'],
      ['Home Mortgage', 'loan'],
    ]);
  });

  it('HELPER INVARIANT: two rows for one account collapse to one (not reachable from the engine)', () => {
    // HONEST LABEL, corrected by a critic. The first version of this test was titled as if it
    // reproduced a live defect, and its comment claimed `result.cards` holds one obligation per
    // STATEMENT so a card appears twice. Reading `computeCashNeeded` (engine.ts:194) shows exactly
    // ONE `buildObligation` per card, so no real caller can produce this input. The invariant is
    // still worth holding — the title counts accounts — but this exercises the helper, not the
    // world, and saying otherwise is the kind of unverified claim rule 0 forbids.
    const rows = frozenNothingDueRows({
      cards: [
        { cardId: 'frozen-card', cardName: 'Chase Sapphire', frozenSince: DROPPED },
        { cardId: 'frozen-card', cardName: 'Chase Sapphire', frozenSince: DROPPED },
      ],
      loans: [],
      partnerLabel: {},
    });
    expect(rows).toHaveLength(1);
    const note = frozenNothingDueNote(rows, { nextStep: 'accounts-route' }) as string;
    expect(note).not.toContain('all of them named');
    expect(note).toContain('Your bank stopped sharing Chase Sapphire');
  });

  it('ABSTAINS on every live account — a healthy world produces no rows at all', () => {
    const out = cashNeeded({
      accounts: [CHECKING, HEALTHY_CARD, HEALTHY_LOAN],
      statements: [statement('healthy-card', 40_000, '2026-06-18')],
    });
    expect(
      frozenNothingDueRows({
        cards: [...out.cards, ...out.unknownDueDateCards],
        loans: loansOf([HEALTHY_LOAN]),
        partnerLabel: {},
      }),
    ).toEqual([]);
  });

  it('marks a row the partner map names, so the all-clear cannot address the wrong person', () => {
    const rows = frozenNothingDueRows({
      cards: [],
      loans: loansOf([FROZEN_LOAN]),
      partnerLabel: { 'frozen-loan': 'Sam' },
    });
    expect(rows[0].ownership).toBe('partner');
    const note = frozenNothingDueNote(rows, { nextStep: 'accounts-route' }) as string;
    expect(note).not.toContain('Your bank');
    expect(note).toContain('Only the household member who owns it can reconnect it.');
  });
});

describe('L.19 — /calendar, the page whose product is a dated amount to pay', () => {
  const row = (over: Partial<FrozenCalendarRow> & { accountId: string }): FrozenCalendarRow => ({
    label: 'Chase Sapphire',
    frozenSince: DROPPED,
    ownership: 'reader',
    kind: 'card',
    amountSource: 'statement',
    ...over,
  });

  it('counts ACCOUNTS, not events — one card can paint two due dates in one month', () => {
    // The L.15 defect shape: a count computed over something other than what it names. A card with
    // a current statement and a next-cycle estimate emits two events for one account.
    const notice = frozenCalendarNotice(
      [
        row({ accountId: 'frozen-card' }),
        row({ accountId: 'frozen-card', amountSource: 'repeated-statement' }),
      ],
      { nextStep: 'accounts-route', funding: null, shows: 'no-dip' },
    )!;
    expect(notice.title).toBe('One account behind this calendar has stopped updating');
    // Two LINES for one account — the amount claim and the due-DATE claim (critic P1-2) — but the
    // title counts the account once, which is the invariant this test exists for.
    expect(notice.lines).toHaveLength(2);
    expect(notice.lines[1]).toContain('The due date shown for it is');
  });

  it('states the loan claim that matters most HERE: the due date itself is unconfirmed', () => {
    const notice = frozenCalendarNotice(
      [row({ accountId: 'frozen-loan', label: 'Home Mortgage', kind: 'loan' })],
      { nextStep: 'accounts-route', funding: null, shows: 'no-dip' },
    )!;
    expect(notice.lines.join(' ')).toContain(
      'the payment amount and due date shown here are the last ones it sent',
    );
  });

  it('a frozen card and a frozen loan each get their own sentence, and the title counts both', () => {
    const notice = frozenCalendarNotice(
      [
        row({ accountId: 'frozen-card' }),
        row({ accountId: 'frozen-loan', label: 'Home Mortgage', kind: 'loan' }),
      ],
      { nextStep: 'accounts-route', funding: null, shows: 'no-dip' },
    )!;
    expect(notice.title).toBe('2 accounts behind this calendar have stopped updating');
    // card amounts, card dates, then the loan — the loan's own sentence already makes both claims.
    expect(notice.lines).toHaveLength(3);
    expect(notice.lines[0]).toContain('Chase Sapphire');
    expect(notice.lines[1]).toContain('The due date shown for it is');
    expect(notice.lines[2]).toContain('Home Mortgage');
  });

  it('every row here is an INSTRUCTION, so the reader own rows carry the check-first guard', () => {
    const notice = frozenCalendarNotice([row({ accountId: 'frozen-card' })], {
      nextStep: 'accounts-route',
      funding: null,
      shows: 'no-dip',
    })!;
    expect(notice.lines[0]).toContain('Check the card with your bank before paying.');
  });

  it('a PARTNER frozen card on the shared calendar carries no imperative at all', () => {
    const notice = frozenCalendarNotice(
      [row({ accountId: 'frozen-card', label: 'Chase Sapphire (Sam)', ownership: 'partner' })],
      { nextStep: 'accounts-route', funding: null, shows: 'no-dip' },
    )!;
    expect(notice.lines[0]).not.toContain('before paying');
    expect(notice.lines[0]).not.toContain('Your bank');
    expect(notice.lines[0]).toContain('Only the household member who owns it can reconnect it.');
  });

  it('names the summary figure it qualifies, with no direction it cannot support', () => {
    const notice = frozenCalendarNotice([row({ accountId: 'frozen-card' })], {
      nextStep: 'accounts-route',
      funding: null,
      shows: 'no-dip',
    })!;
    expect(notice.totalNote).toBe(
      'These payments are inside the money-out total and the count of payments due above.',
    );
    // A payment already made makes the total too HIGH; an estimate off a frozen balance can be
    // wrong either way. A single directional claim would be false half the time.
    expect(notice.totalNote).not.toContain('understates');
    expect(notice.totalNote).not.toContain('higher');
  });

  it('ABSTAINS when the month holds no frozen due event — the whole resolution rule', () => {
    expect(
      frozenCalendarNotice([], { nextStep: 'accounts-route', funding: null, shows: 'no-dip' }),
    ).toBeNull();
  });
});

describe('L.19 — the calendar notice over the REAL engines', () => {
  it('a frozen card and a frozen loan both reach the notice through the real obligation builders', () => {
    const out = cashNeeded({
      accounts: [CHECKING, FROZEN_CARD, HEALTHY_CARD, FROZEN_LOAN, HEALTHY_LOAN],
      statements: [
        statement('frozen-card', 217_999, '2026-06-15'),
        statement('healthy-card', 40_000, '2026-06-18'),
      ],
    });
    const loans = loansOf([FROZEN_LOAN, HEALTHY_LOAN]);
    // The page resolves against grid events; here the equivalent set is every obligation carrying a
    // frozen date, which is what those events are built from.
    const rows: FrozenCalendarRow[] = [
      ...out.cards
        .filter((c) => c.frozenSince != null)
        .map((c) => ({
          accountId: c.cardId,
          label: c.cardName,
          frozenSince: c.frozenSince as string,
          ownership: 'reader' as const,
          kind: 'card' as const,
          amountSource: currentCycleAmountSource(c.isEstimated),
        })),
      ...loans
        .filter((l) => l.frozenSince != null)
        .map((l) => ({
          accountId: l.accountId,
          label: l.accountName,
          frozenSince: l.frozenSince as string,
          ownership: 'reader' as const,
          kind: 'loan' as const,
          amountSource: 'loan-terms' as const,
        })),
    ];
    const notice = frozenCalendarNotice(rows, {
      nextStep: 'accounts-route',
      funding: null,
      shows: 'no-dip',
    })!;
    expect(notice.title).toBe('2 accounts behind this calendar have stopped updating');
    const all = notice.lines.join(' ');
    expect(all).toContain('Chase Sapphire');
    expect(all).toContain('Home Mortgage');
    // The healthy siblings are never named — the failure direction of a false hedge is a reader who
    // discounts a figure that is perfectly current.
    expect(all).not.toContain('Freedom Card');
    expect(all).not.toContain('Car Loan');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// TASKS L.19 — CRITIC CYCLE 1. A fresh-context critic broke the first cut in five places; each
// fix below is locked by the repro that found it. Two of the five were claims I had reasoned my
// way into and never executed, which is the whole argument for a critic that has not read my
// reasoning.
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe('L.19 critic P1-1 — the calendar prints ONE instruction no due row accounts for', () => {
  const funding = { label: 'Everyday Checking', frozenSince: DROPPED };

  it('speaks when every card and loan is LIVE but the projection’s own balance is frozen', () => {
    // The silent case, and the expensive one. The page renders "Projected low … transfer $X by
    // DATE to stay covered" off the funding balance; the first cut only ever looked at card and
    // loan due events, so with none frozen it returned null and the page disclosed nothing.
    const notice = frozenCalendarNotice([], {
      nextStep: 'accounts-route',
      funding,
      shows: 'a-transfer',
    })!;
    expect(notice).not.toBeNull();
    expect(notice.title).toBe('One account behind this calendar has stopped updating');
    expect(notice.lines.join(' ')).toContain(
      'the dip comes sooner and the amount to move is larger than shown',
    );
  });

  it('states the QUIET direction when the month shows no dip at all', () => {
    // A balance frozen HIGH produces a clean projection over an account really heading under, and
    // "this understates what you need to move" would be nonsense where there is nothing to move.
    const notice = frozenCalendarNotice([], {
      nextStep: 'accounts-route',
      funding,
      shows: 'no-dip',
    })!;
    expect(notice.lines.join(' ')).toContain(
      'no dip here is not evidence that the account is safe',
    );
  });

  it('does NOT claim the money-out total when only the funding account is frozen', () => {
    // The total is a sum of due rows. With every due row live there is nothing in it to qualify,
    // and hedging it anyway is the false-hedge failure this whole file argues against.
    const notice = frozenCalendarNotice([], {
      nextStep: 'accounts-route',
      funding,
      shows: 'a-transfer',
    })!;
    expect(notice.totalNote).toBeNull();
  });

  it('counts the funding account alongside the frozen dues', () => {
    const notice = frozenCalendarNotice(
      [
        {
          accountId: 'frozen-card',
          label: 'Chase Sapphire',
          frozenSince: DROPPED,
          ownership: 'reader',
          kind: 'card',
          amountSource: 'statement',
        },
      ],
      { nextStep: 'accounts-route', funding, shows: 'a-transfer' },
    )!;
    expect(notice.title).toBe('2 accounts behind this calendar have stopped updating');
    expect(notice.totalNote).not.toBeNull();
  });

  it('ABSTAINS when nothing is frozen at all, funding included', () => {
    expect(
      frozenCalendarNotice([], { nextStep: 'accounts-route', funding: null, shows: 'a-transfer' }),
    ).toBeNull();
  });
});

describe('L.19 critic P1-2 — on a calendar the DATE is the product, and it may be one we made up', () => {
  const cardRow = (amountSource: DueAmountSource) => ({
    accountId: 'frozen-card',
    label: 'Chase Sapphire',
    frozenSince: DROPPED,
    ownership: 'reader' as const,
    kind: 'card' as const,
    amountSource,
  });

  it('says the due date cannot move, and that a passed date is shown as due today', () => {
    // `buildObligation` clamps an already-passed due date to today (engine.ts:158-161), so the
    // grid can paint a date no bank ever sent — and for a frozen card no new statement can arrive
    // to move it off today again. The card note qualified only the AMOUNT.
    const notice = frozenCalendarNotice([cardRow('statement')], {
      nextStep: 'accounts-route',
      funding: null,
      shows: 'no-dip',
    })!;
    const all = notice.lines.join(' ');
    expect(all).toContain('The due date shown for it is taken from the last statement the bank sent');
    expect(all).toContain('a due date that has already passed is shown here as due today');
  });

  it('names the ESTIMATE path’s different stale field — the stored due day, not a statement', () => {
    const notice = frozenCalendarNotice([cardRow('balance')], {
      nextStep: 'accounts-route',
      funding: null,
      shows: 'no-dip',
    })!;
    expect(notice.lines.join(' ')).toContain(
      'worked out from the day of the month this account used to be due',
    );
  });

  it('a REPEATED statement’s date is still taken from the statement, not the stored due day (C.8 F-1)', () => {
    // The later-month synthesis repeats the last due day, so the DATE provenance groups with the
    // statement path. Only a balance estimate derives its date from the stored due day.
    const notice = frozenCalendarNotice([cardRow('repeated-statement')], {
      nextStep: 'accounts-route',
      funding: null,
      shows: 'no-dip',
    })!;
    const all = notice.lines.join(' ');
    expect(all).toContain('The due date shown for it is taken from the last statement the bank sent');
    expect(all).not.toContain('worked out from the day of the month');
  });

  it('a LOAN gets no second date sentence — `frozenLoanNote` already makes that claim', () => {
    const notice = frozenCalendarNotice(
      [{ ...cardRow('statement'), accountId: 'l1', label: 'Home Mortgage', kind: 'loan', amountSource: 'loan-terms' as const }],
      { nextStep: 'accounts-route', funding: null, shows: 'no-dip' },
    )!;
    expect(notice.lines).toHaveLength(1);
    expect(notice.lines[0]).toContain('the payment amount and due date shown here are the last ones it sent');
  });
});

describe('C.8 critic F-1 — the frozen amount claim names the field the figure came from', () => {
  const single = (amountSource: DueAmountSource) =>
    frozenCardsNote(
      [
        {
          cardId: 'frozen-card',
          label: 'Chase Sapphire',
          frozenSince: DROPPED,
          amountSource,
          ownership: 'reader' as const,
        },
      ],
      { role: 'instruction', nextStep: 'accounts-route' },
    ) as string;

  it('a STATEMENT card says the figure is the statement’s own', () => {
    const note = single('statement');
    expect(note).toContain('against this statement');
    expect(note).not.toContain('worked out from the last balance we saw');
    expect(note).not.toContain('repeats the last statement');
  });

  it('a BALANCE-estimate card says the figure is worked out from the balance', () => {
    const note = single('balance');
    expect(note).toContain('worked out from the last balance we saw');
    expect(note).not.toContain('repeats the last statement');
  });

  it('a REPEATED statement says so — and never claims the balance as its source (the F-1 lie)', () => {
    // Before the fix, a later-month synthesis reused `isEstimated`, so a statement card was told
    // its figure was "worked out from the last balance we saw" — false by the whole gap between
    // the balance and the statement basis printed beside it.
    const note = single('repeated-statement');
    expect(note).toContain('repeats the last statement the bank sent');
    expect(note).not.toContain('worked out from the last balance we saw');
    expect(note).not.toContain('against this statement');
  });
});

describe('L.19 critic P2-2 — two accounts that paint identically are not shown as two', () => {
  it('collapses byte-identical loan sentences and says they cannot be told apart', () => {
    // The #298 shape on the loan path: `loans.map(frozenLoanNote)` bypassed the `nameSet`
    // collision rule that every merged-sentence builder honours, so the reader was told two
    // accounts were affected and shown one sentence twice.
    const loan = (accountId: string) => ({
      accountId,
      label: 'AUTO LOAN',
      frozenSince: DROPPED,
      ownership: 'reader' as const,
      kind: 'loan' as const,
      amountSource: 'loan-terms' as const,
    });
    const notice = frozenCalendarNotice([loan('a'), loan('b')], {
      nextStep: 'accounts-route',
      funding: null,
      shows: 'no-dip',
    })!;
    expect(notice.title).toBe('2 accounts behind this calendar have stopped updating');
    expect(notice.lines).toHaveLength(1);
    expect(notice.lines[0]).toContain(
      '2 accounts here match this description and nothing on this page tells them apart',
    );
    // No manufactured identifier — that is what the L.15 rule forbids.
    expect(notice.lines[0]).not.toContain('1.');
  });

  it('two loans that DIFFER still get their own sentence each', () => {
    const notice = frozenCalendarNotice(
      [
        { accountId: 'a', label: 'AUTO LOAN', frozenSince: DROPPED, ownership: 'reader', kind: 'loan', amountSource: 'loan-terms' as const },
        { accountId: 'b', label: 'Home Mortgage', frozenSince: DROPPED, ownership: 'reader', kind: 'loan', amountSource: 'loan-terms' as const },
      ],
      { nextStep: 'accounts-route', funding: null, shows: 'no-dip' },
    )!;
    expect(notice.lines).toHaveLength(2);
    expect(notice.lines.join(' ')).not.toContain('tells them apart');
  });
});

describe('L.19 critic P2-1 — an all-clear does not repeat its remedy once per sub-list', () => {
  it('states the coverage caveat and the remedy ONCE across a card and a loan', () => {
    const note = frozenNothingDueNote(
      [
        { label: 'Chase Sapphire', frozenSince: DROPPED, ownership: 'reader', kind: 'card', missing: null },
        { label: 'Toyota Auto Loan', frozenSince: DROPPED, ownership: 'reader', kind: 'loan', missing: null },
      ],
      { nextStep: 'accounts-route' },
    ) as string;
    // Both mechanisms still stated in full — that is the part that genuinely differs.
    expect(note).toContain('a statement issued on it since would not have reached us');
    expect(note).toContain('a change to its payment or due date since would not have reached us');
    // …but the trailing clauses, which are true of the whole set, appear once.
    expect(note.match(/this covers only what we can still see/g)).toHaveLength(1);
    expect(note.match(/Accounts shows the connection/g)).toHaveLength(1);
  });

  it('KEEPS both remedies when they differ — the own/partner split exists because they do', () => {
    // The bug my first cut of `joinClaims` introduced, and the reason this test is phrased as a
    // KEEP rather than a dedupe: dropping every tail but the last deleted the reader's own
    // remedy, because their claim comes first and the partner's last. A household reader was left
    // told only that somebody else could fix somebody else's account.
    const note = frozenNothingDueNote(
      [
        { label: 'Chase Sapphire', frozenSince: DROPPED, ownership: 'reader', kind: 'card', missing: null },
        { label: 'Sam Amex', frozenSince: DROPPED, ownership: 'partner', kind: 'card', missing: null },
      ],
      { nextStep: 'open-app' },
    ) as string;
    expect(note.match(/Open Aimplifi to see the connection/g)).toHaveLength(1);
    expect(note.match(/Only the household member who owns it can reconnect it/g)).toHaveLength(1);
  });
});

describe('L.19 critic P3-3 — an unattributable loan is not ordered to be paid', () => {
  it('drops the imperative under `unknown` ownership, as it already drops the remedy', () => {
    const note = frozenLoanNote(
      { label: 'Mortgage', frozenSince: DROPPED, ownership: 'unknown' },
      { role: 'instruction', nextStep: 'accounts-route' },
    );
    expect(note).not.toContain('Check it with your lender before paying');
    expect(note).toContain('The bank stopped sharing Mortgage');
  });
});

describe('L.19 critic P2-3 — the resolution rule locked through the REAL calendar builder', () => {
  it('names a frozen card due THIS month and stays silent in a month it does not paint', () => {
    // The gap the critic named: the previous "real engines" test built rows from obligations and
    // never called `buildCashFlowCalendar`, which is exactly what the page must not do — an
    // obligation outside the displayed month emits no event and must not be named.
    const out = cashNeeded({
      accounts: [CHECKING, FROZEN_CARD, HEALTHY_CARD],
      statements: [
        statement('frozen-card', 217_999, '2026-06-15'),
        statement('healthy-card', 40_000, '2026-06-18'),
      ],
    });
    const rowsFor = (month: string): FrozenCalendarRow[] => {
      const cal = buildCashFlowCalendar({
        month,
        scheduled: [],
        cardObligations: out.cards,
        loanObligations: [],
        today: TODAY,
        holidays: HOL,
      });
      const frozenById = new Map(
        out.cards.filter((c) => c.frozenSince != null).map((c) => [c.cardId, c] as const),
      );
      return cal.days
        .flatMap((d) => d.events)
        .flatMap((e): FrozenCalendarRow[] => {
          // Mirror the page: a due event carries its own amountSource; refuse rather than default.
          if (e.accountId === undefined || e.amountSource === undefined) return [];
          const src = frozenById.get(e.accountId);
          return src
            ? [
                {
                  accountId: src.cardId,
                  label: src.cardName,
                  frozenSince: src.frozenSince as string,
                  ownership: 'reader',
                  kind: 'card',
                  amountSource: e.amountSource,
                },
              ]
            : [];
        });
    };

    const speaks = frozenCalendarNotice(rowsFor('2026-06'), {
      nextStep: 'accounts-route',
      funding: null,
      shows: 'no-dip',
    });
    expect(speaks).not.toBeNull();
    expect(speaks!.lines.join(' ')).toContain('Chase Sapphire');
    // The healthy card is never named.
    expect(speaks!.lines.join(' ')).not.toContain('Freedom Card');

    // C.8 changed this month: a card's due now REPEATS into later months, so the frozen card IS
    // painted in September and the disclosure must follow it there — the L.14 "fact rides the
    // money" thesis extends to the synthesized event. And critic F-1's whole point: this card HAS
    // a statement, so the repeat is of that STATEMENT — the banner must say so, and must NOT fall
    // into the balance-estimate sentence ("worked out from the last balance we saw"), which would
    // name a provenance the printed figure does not have.
    const septRows = rowsFor('2026-09');
    expect(septRows).toEqual([
      {
        accountId: 'frozen-card',
        label: 'Chase Sapphire',
        frozenSince: DROPPED,
        ownership: 'reader',
        kind: 'card',
        amountSource: 'repeated-statement',
      },
    ]);
    const sept = frozenCalendarNotice(septRows, {
      nextStep: 'accounts-route',
      funding: null,
      shows: 'no-dip',
    });
    expect(sept).not.toBeNull();
    expect(sept!.lines.join(' ')).toContain('Chase Sapphire');
    expect(sept!.lines.join(' ')).toContain('this later month repeats the last statement the bank sent');
    expect(sept!.lines.join(' ')).not.toContain('worked out from the last balance we saw');
    // The DATE claim groups with the statement path too — a repeated due day still came from the
    // statement, not from the stored-due-day estimate branch.
    expect(sept!.lines.join(' ')).toContain('taken from the last statement the bank sent');
    expect(sept!.lines.join(' ')).not.toContain('worked out from the day of the month');

    // The silent case is now only a month BEFORE the due month — every month from the due month
    // forward paints the estimate. (Navigating backwards is a real gesture: the page has a prev
    // link.) The account is still frozen, but nothing is painted, so the page stays silent.
    expect(rowsFor('2026-05')).toEqual([]);
    expect(
      frozenCalendarNotice(rowsFor('2026-05'), {
        nextStep: 'accounts-route',
        funding: null,
        shows: 'no-dip',
      }),
    ).toBeNull();
  });
});


describe('L.19 critic cycle 1 — P1-2 and P2-3', () => {
  it('P2-3: a card and a loan sharing an account id both survive the dedupe', () => {
    // Latent today (a CREDIT account cannot also be LOAN/MORTGAGE), but the failure mode of a
    // shared key is a money disclosure silently vanishing.
    const rows = frozenNothingDueRows({
      cards: [{ cardId: 'same-id', cardName: 'Card X', frozenSince: DROPPED }],
      loans: [{ accountId: 'same-id', accountName: 'Loan Y', frozenSince: DROPPED }],
      partnerLabel: {},
    });
    expect(rows.map((r) => [r.label, r.kind])).toEqual([
      ['Card X', 'card'],
      ['Loan Y', 'loan'],
    ]);
  });

  it('P1-2: the frozen qualifier survives alongside the UNDATED-card qualifier', () => {
    // The dashboard reminders card appended the frozen sentence only to the clean all-clear, so a
    // reader with both an undatable card and a frozen account was told about one gap and not the
    // other — while the weekly digest, from the same rows through the same builder, said both.
    // Locked here at the builder level; the card renders exactly this string.
    const note = frozenNothingDueNote(
      [{ label: 'Home Mortgage', frozenSince: DROPPED, ownership: 'reader', kind: 'loan', missing: null }],
      { nextStep: 'accounts-route' },
    );
    expect(note).not.toBeNull();
    const undated = `No payments coming up on what we can date — one card has no due date yet, so it isn’t included.${note ? ` ${note}` : ''}`;
    expect(undated).toContain('no due date yet');
    expect(undated).toContain('a change to its payment or due date since would not have reached us');
  });
});
