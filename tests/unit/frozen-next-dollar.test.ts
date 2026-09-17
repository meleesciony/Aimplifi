/**
 * TASKS L.19 residual (5) — the next-dollar ranking named a debt to send extra money to over a
 * balance the bank stopped sharing, with nothing said.
 *
 * `src/server/coach.ts` built the ranking's loans from `snap.accounts` without `feedDroppedAt`,
 * and its past-due cards from obligations that carried the stamp and dropped it on the way — the
 * same server-side NARROWING DECISIONS #742 closed on the debt-payoff path, one read path over.
 * Downstream, /coach's "Your next dollar" card and Ask's `next_dollar` answer printed "Next extra
 * dollar: <loan> (12.00% APR)" — an instruction — over a frozen premise.
 *
 * Driven against the REAL read path (Prisma) and the REAL engine where the defect lived, per the
 * L.18/L.19 files this sits beside: a pure-builder test cannot catch a wiring bug, and a narrowing
 * IS a wiring bug.
 *
 * ABSTENTIONS ARE PINNED TO GOLDEN LITERALS. The failure this slice can introduce is a caveat on a
 * ranking no frozen account feeds — a false hedge — so every "it speaks" case has a "stays silent"
 * twin compared against a literal, never against the code's own default (the L.15 finding that an
 * `f(x, null) === f(x)` assertion cannot fail). And the note must be about the debt the copy
 * PRINTS: a frozen loan the plan ranked but never named must not be disclosed (the guard reads
 * what it guards).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { addDays, isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import { frozenNextDollarNote } from '@/lib/engine/account/feed-dropped-view';
import { answerNextDollar } from '@/lib/engine/assistant/answer';
import { COACH_COPY, nextDollarNamedDebt } from '@/lib/engine/fi/coach-copy';
import {
  classifyDebts,
  nextDollar,
  type NextDollarDebt,
  type NextDollarInput,
  type NextDollarPlan,
} from '@/lib/engine/fi/next-dollar';
import { getCoachData } from '@/server/coach';

const DROPPED = '2026-05-28';
const DROPPED_LONG = 'Thu, May 28, 2026';

const debt = (over: Partial<NextDollarDebt> & { id: string; name: string }): NextDollarDebt => ({
  kind: 'installment',
  balanceCents: 500_000,
  aprBps: 1_200,
  frozenSince: null,
  ...over,
});

const PERSONAL_LOAN = debt({ id: 'personal', name: 'Personal Loan' });
const FROZEN_PERSONAL_LOAN = debt({ ...PERSONAL_LOAN, frozenSince: DROPPED });
const AUTO_LOAN = debt({ id: 'auto', name: 'Auto Loan', balanceCents: 1_430_000, aprBps: 649 });
const FROZEN_AUTO_LOAN = debt({ ...AUTO_LOAN, frozenSince: DROPPED });
const STORE_CARD = debt({ id: 'store', name: 'Store Card', kind: 'revolving', balanceCents: 4_350, aprBps: 3_199 });
const FROZEN_STORE_CARD = debt({ ...STORE_CARD, frozenSince: DROPPED });

function plan(over: Partial<NextDollarInput> = {}): NextDollarPlan {
  return nextDollar({
    debts: [],
    expectedReturnBps: 700,
    returnIsDefault: true,
    runwayMonths: 4.2,
    employerMatch: 'unknown',
    taxAdvantagedRoom: 'unknown',
    ...over,
  });
}

const REMEDY = ' Accounts shows the connection and how to fix or remove it.';
const CARD_SENTENCE = `Your bank stopped sharing Store Card on ${DROPPED_LONG}, so the past-due amount that ranks it here is from the last statement it sent — a payment you have already made may not be counted, so the card may not be past due at all.${REMEDY}`;
const LOAN_SENTENCE = `Your bank stopped sharing Personal Loan on ${DROPPED_LONG}, so what we know about this loan is the last thing it sent — nothing about it has been confirmed since, including whether it is still open.${REMEDY}`;
const AUTO_SENTENCE = LOAN_SENTENCE.replace('Personal Loan', 'Auto Loan');

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('frozenNextDollarNote — the sentence, per kind', () => {
  const OPTS = { nextStep: 'accounts-route' } as const;

  it('a card: the PREMISE (past due) is what went stale, and it may no longer hold', () => {
    expect(frozenNextDollarNote({ label: 'Store Card', frozenSince: DROPPED, kind: 'card' }, OPTS)).toBe(
      CARD_SENTENCE,
    );
  });

  it('a loan: NO direction, and no claim about the rate — only that nothing confirms it is still open', () => {
    const note = frozenNextDollarNote({ label: 'Personal Loan', frozenSince: DROPPED, kind: 'loan' }, OPTS);
    expect(note).toBe(LOAN_SENTENCE);
    // A line of credit is a LOAN here and a draw pushes the real balance UP (the #742 critic
    // P1-1 rule); and a variable rate the bank stopped sending would be stale too, so the note
    // may not certify the rate as current either.
    expect(note).not.toMatch(/only be lower|may be lower|does not go stale|rate is (current|fresh)/);
  });

  it('a push body or an in-line step: no remedy tail', () => {
    expect(
      frozenNextDollarNote({ label: 'Store Card', frozenSince: DROPPED, kind: 'card' }, { nextStep: 'nothing' }),
    ).toBe(CARD_SENTENCE.slice(0, -REMEDY.length));
  });

  it('no row → null, so an unaffected surface is byte-identical', () => {
    expect(frozenNextDollarNote(null, OPTS)).toBeNull();
  });

  it('the label is sanitised like every other sentence in the file (bidi/zero-width stripped)', () => {
    expect(
      frozenNextDollarNote({ label: 'Store\u200B \u202ECard', frozenSince: DROPPED, kind: 'card' }, OPTS),
    ).toBe(CARD_SENTENCE);
    expect(frozenNextDollarNote({ label: '\u200B', frozenSince: DROPPED, kind: 'card' }, OPTS)).toContain(
      'Unnamed account',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('nextDollarNamedDebt — the selector agrees with the sentences it guards', () => {
  const ALL_NAMES = [PERSONAL_LOAN.name, AUTO_LOAN.name, STORE_CARD.name];
  const printed = (p: NextDollarPlan) =>
    `${COACH_COPY.nextDollarHeadline(p)} ${COACH_COPY.nextDollarWhy(p)}`;

  const cases: [string, NextDollarPlan][] = [
    ['revolving winner', plan({ debts: [STORE_CARD, AUTO_LOAN], runwayMonths: 1.5 })],
    ['employer match', plan({ debts: [PERSONAL_LOAN], employerMatch: 'uncaptured' })],
    ['emergency fund', plan({ debts: [PERSONAL_LOAN], runwayMonths: 1.5 })],
    ['installment winner', plan({ debts: [PERSONAL_LOAN, AUTO_LOAN] })],
    ['tax-advantaged room', plan({ debts: [AUTO_LOAN], taxAdvantagedRoom: 'remaining' })],
    ['invest, a loan that lost the comparison', plan({ debts: [AUTO_LOAN] })],
    ['invest, no loan at all', plan({ debts: [] })],
  ];

  it.each(cases)('%s: a debt is named by the selector iff the copy prints its name, and no other', (_, p) => {
    const named = nextDollarNamedDebt(p);
    const text = printed(p);
    for (const name of ALL_NAMES) {
      expect(text.includes(name), `${name} printed=${text.includes(name)} named=${named?.name}`).toBe(
        named?.name === name,
      );
    }
  });

  it('the concrete expectations, so the table above cannot be vacuous', () => {
    expect(nextDollarNamedDebt(plan({ debts: [STORE_CARD, AUTO_LOAN], runwayMonths: 1.5 }))?.id).toBe('store');
    expect(nextDollarNamedDebt(plan({ debts: [PERSONAL_LOAN, AUTO_LOAN] }))?.id).toBe('personal');
    expect(nextDollarNamedDebt(plan({ debts: [AUTO_LOAN] }))?.id).toBe('auto');
    expect(nextDollarNamedDebt(plan({ debts: [PERSONAL_LOAN], runwayMonths: 1.5 }))).toBeNull();
    expect(nextDollarNamedDebt(plan({ debts: [] }))).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('COACH_COPY.nextDollarFrozenNote — about the debt on screen, never one off it', () => {
  it('the revolving winner is frozen → the card sentence', () => {
    const p = plan({ debts: [FROZEN_STORE_CARD, AUTO_LOAN], runwayMonths: 1.5 });
    expect(p.destination).toBe('revolving_debt');
    expect(COACH_COPY.nextDollarFrozenNote(p)).toBe(CARD_SENTENCE);
  });

  it('the installment winner is frozen → the loan sentence; a frozen sibling that LOST is not named', () => {
    const p = plan({ debts: [FROZEN_PERSONAL_LOAN, FROZEN_AUTO_LOAN] });
    expect(p.destination).toBe('installment_debt');
    const note = COACH_COPY.nextDollarFrozenNote(p);
    expect(note).toBe(LOAN_SENTENCE);
    expect(note).not.toContain('Auto Loan');
  });

  it('investing, with the losing comparison frozen → the why names that loan, so the note does too', () => {
    const p = plan({ debts: [FROZEN_AUTO_LOAN] });
    expect(p.destination).toBe('invest');
    expect(COACH_COPY.nextDollarWhy(p)).toContain('Auto Loan');
    expect(COACH_COPY.nextDollarFrozenNote(p)).toBe(AUTO_SENTENCE);
  });

  it('a frozen loan the plan RANKED but the copy never PRINTS is not disclosed (the loudest-branch lesson, inverted)', () => {
    // Emergency fund wins; the why prints the runway, not the loan.
    const emergency = plan({ debts: [FROZEN_PERSONAL_LOAN], runwayMonths: 1.5 });
    expect(emergency.destination).toBe('emergency_fund');
    expect(emergency.highestInstallment?.frozenSince).toBe(DROPPED);
    expect(`${COACH_COPY.nextDollarHeadline(emergency)} ${COACH_COPY.nextDollarWhy(emergency)}`).not.toContain(
      'Personal Loan',
    );
    expect(COACH_COPY.nextDollarFrozenNote(emergency)).toBeNull();
    // Same for an uncaptured match and remaining tax-advantaged room.
    expect(
      COACH_COPY.nextDollarFrozenNote(plan({ debts: [FROZEN_PERSONAL_LOAN], employerMatch: 'uncaptured' })),
    ).toBeNull();
    expect(
      COACH_COPY.nextDollarFrozenNote(plan({ debts: [FROZEN_AUTO_LOAN], taxAdvantagedRoom: 'remaining' })),
    ).toBeNull();
  });

  it('the winner is frozen but a different, LIVE debt is named → silent (the note follows the name)', () => {
    // The frozen store card is the winner's sibling only when it does not beat the return; make
    // the live loan win and freeze the loser.
    const p = plan({ debts: [PERSONAL_LOAN, FROZEN_AUTO_LOAN] });
    expect(p.destination).toBe('installment_debt');
    expect(p.debt?.id).toBe('personal');
    expect(COACH_COPY.nextDollarFrozenNote(p)).toBeNull();
  });

  it('nothing frozen → null', () => {
    expect(COACH_COPY.nextDollarFrozenNote(plan({ debts: [STORE_CARD, AUTO_LOAN], runwayMonths: 1.5 }))).toBeNull();
    expect(COACH_COPY.nextDollarFrozenNote(plan({ debts: [PERSONAL_LOAN] }))).toBeNull();
    expect(COACH_COPY.nextDollarFrozenNote(plan({ debts: [AUTO_LOAN] }))).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('nextDollar — DISCLOSE, ADJUST NOTHING', () => {
  const strip = (p: NextDollarPlan) =>
    JSON.parse(JSON.stringify(p, (k, v) => (k === 'frozenSince' ? undefined : v)));

  it('the ranking is byte-identical with every stamp set and with every stamp stripped', () => {
    const frozen = [FROZEN_STORE_CARD, FROZEN_PERSONAL_LOAN, FROZEN_AUTO_LOAN];
    const live = frozen.map((d) => debt({ ...d, frozenSince: null }));
    for (const over of [
      { runwayMonths: 1.5 },
      { runwayMonths: 4.2 },
      { employerMatch: 'uncaptured' as const },
      { taxAdvantagedRoom: 'remaining' as const },
      { expectedReturnBps: 4_000 },
    ]) {
      expect(strip(plan({ debts: frozen, ...over }))).toEqual(strip(plan({ debts: live, ...over })));
    }
  });

  it('classifyDebts carries the stamp verbatim on both kinds', () => {
    const debts = classifyDebts({
      loans: [{ id: 'l', name: 'Loan', balanceCents: 1_000, aprBps: 900, frozenSince: DROPPED }],
      pastDueCards: [{ id: 'c', name: 'Card', remainingDueCents: 1_000, aprBps: 2_400, frozenSince: '2026-06-01' }],
    });
    expect(debts.map((d) => [d.id, d.frozenSince])).toEqual([
      ['c', '2026-06-01'],
      ['l', DROPPED],
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('Ask — "where should my next dollar go?"', () => {
  it('the note leads the detail, in the same position the /coach card gives it; facts untouched', () => {
    const frozen = plan({ debts: [FROZEN_PERSONAL_LOAN, AUTO_LOAN] });
    const live = plan({ debts: [PERSONAL_LOAN, AUTO_LOAN] });
    const a = answerNextDollar(frozen);
    const golden = answerNextDollar(live);
    expect(a.detail).toBe(`${LOAN_SENTENCE} ${golden.detail}`);
    expect(a.headline).toBe(golden.headline);
    expect(a.facts).toEqual(golden.facts);
    expect(a.facts).toEqual([{ label: 'Personal Loan', value: '12.00% APR' }]);
  });

  it('with nothing frozen the detail is the GOLDEN four-sentence run — no caveat from nowhere', () => {
    const p = plan({ debts: [PERSONAL_LOAN, AUTO_LOAN] });
    const a = answerNextDollar(p);
    expect(a.detail).toBe(
      [
        COACH_COPY.nextDollarWhy(p),
        COACH_COPY.nextDollarSkipped(p),
        COACH_COPY.nextDollarCardsNote(),
        COACH_COPY.nextDollarAssumptions(p),
      ].join(' '),
    );
    expect(a.detail?.startsWith('Personal Loan is 12.00%, above ')).toBe(true);
    expect(JSON.stringify(a)).not.toContain('stopped sharing');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('getCoachData — the fact rides the money through the real read path', () => {
  const U = `l19-nd-${Date.now()}-${process.pid}`;
  let today: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
    await prisma.user.create({ data: { id: U, email: `${U}@test.local` } });
    today = getProvider().today(U);
    const mk = (
      name: string,
      type: string,
      balance: number,
      dropped: string | null,
      extra: { aprBps?: number; minimumPaymentCents?: number; dueDayOfMonth?: number; cycleCloseDayOfMonth?: number } = {},
    ) =>
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
          ...extra,
        },
      });
    // A frozen 12% loan (the winner once no card is past due), a live 6.49% loan, and a frozen
    // card whose statement fell due five days ago and is unpaid — the past-due revolving winner.
    await mk('Personal Loan', 'LOAN', 500_000, DROPPED, { aprBps: 1_200, minimumPaymentCents: 15_000 });
    await mk('Auto Loan', 'LOAN', 1_430_000, null, { aprBps: 649, minimumPaymentCents: 38_500 });
    const card = await mk('Store Card', 'CREDIT', 4_350, DROPPED, {
      aprBps: 3_199,
      dueDayOfMonth: 15,
      cycleCloseDayOfMonth: 20,
    });
    await prisma.statement.create({
      data: {
        accountId: card.id,
        cycleStart: addDays(isoDate(today), -40),
        cycleEnd: addDays(isoDate(today), -30),
        dueDate: addDays(isoDate(today), -5),
        statementBalanceCents: 4_350,
        minimumPaymentCents: 3_500,
      },
    });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
  });

  it('a frozen past-due card reaches the plan with its stamp, and the card names it', async () => {
    const d = await getCoachData(U);
    expect(d.nextDollar.destination).toBe('revolving_debt');
    expect(d.nextDollar.debt?.name).toBe('Store Card');
    expect(d.nextDollar.debt?.frozenSince).toBe(DROPPED);
    expect(COACH_COPY.nextDollarFrozenNote(d.nextDollar)).toBe(CARD_SENTENCE);
    // The live loan lost the comparison and is unnamed; the frozen loan is not the winner and so
    // must not be disclosed here either.
    expect(COACH_COPY.nextDollarFrozenNote(d.nextDollar)).not.toContain('Loan');
  });

  it('with the card paid, the frozen loan wins and carries the stamp; the live loan carries null', async () => {
    await prisma.statement.deleteMany({ where: { account: { userId: U } } });
    const d = await getCoachData(U);
    expect(d.nextDollar.destination).toBe('installment_debt');
    expect(d.nextDollar.debt?.name).toBe('Personal Loan');
    expect(d.nextDollar.debt?.frozenSince).toBe(DROPPED);
    expect(d.nextDollar.highestInstallment?.frozenSince).toBe(DROPPED);
    expect(COACH_COPY.nextDollarFrozenNote(d.nextDollar)).toBe(LOAN_SENTENCE);
    // The live sibling reaches the engine as null, not undefined: the boundary ANSWERED.
    await prisma.account.updateMany({ where: { userId: U, name: 'Personal Loan' }, data: { feedDroppedAt: null } });
    const live = await getCoachData(U);
    expect(live.nextDollar.debt?.frozenSince).toBeNull();
    expect(COACH_COPY.nextDollarFrozenNote(live.nextDollar)).toBeNull();
  });
});
