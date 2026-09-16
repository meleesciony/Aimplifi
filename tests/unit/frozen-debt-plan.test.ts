/**
 * TASKS L.19 — the debt-payoff path: the last surface DECISIONS #305 left printing a figure from a
 * balance the bank stopped sharing, with nothing said.
 *
 * `loadDebtAccounts` mapped each liability to the engine's `DebtInput` and dropped `feedDroppedAt`
 * on the way — the same server-side NARROWING #305 diagnosed on the Today feed, the undatable loan
 * and the PDF export. Downstream, /goals' Debt Freedom planner printed "Debt-free by June 2028" and
 * a total interest, and both Ask debt answers printed a payoff month or an extra-per-month, over a
 * frozen balance.
 *
 * Driven against the REAL read path (Prisma) and the REAL engines, per the L.18 file this sits
 * beside: a pure-builder test cannot catch a wiring bug, and a narrowing IS a wiring bug.
 *
 * ABSTENTIONS ARE PINNED TO GOLDEN LITERALS. The failure this slice can introduce is a caveat on a
 * plan no frozen account feeds — a false hedge — so every "it speaks" case has a "stays silent"
 * twin compared against a literal, never against the code's own default (the L.15 finding that an
 * `f(x, null) === f(x)` assertion cannot fail).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import {
  FROZEN_DEBT_PLAN_TESTID,
  frozenDebtPlanNote,
} from '@/lib/engine/account/feed-dropped-view';
import { planDebtPayoff, type DebtAccount } from '@/lib/engine/debt/payoff';
import { solveDebtFreeByDate } from '@/lib/engine/solve/debt-free-by-date';
import { answerDebtFreeByDate, answerDebtPayoff } from '@/lib/engine/assistant/answer';
import { loadDebtAccounts } from '@/server/debt';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TODAY = isoDate('2026-06-10');
const DROPPED = '2026-05-28';
const DROPPED_LONG = 'Thu, May 28, 2026';

const debt = (over: Partial<DebtAccount> & { id: string; name: string }): DebtAccount => ({
  balanceCents: 100_000,
  aprBps: 1_999,
  minimumPaymentCents: 3_500,
  kind: 'card',
  frozenSince: null,
  ...over,
});

const FROZEN_CARD = debt({
  id: 'frozen-card',
  name: 'Chase Sapphire',
  balanceCents: 900_000,
  aprBps: 2_399,
  frozenSince: DROPPED,
});
const HEALTHY_LOAN = debt({
  id: 'auto',
  name: 'Auto Loan',
  kind: 'loan',
  balanceCents: 1_430_000,
  aprBps: 649,
  minimumPaymentCents: 38_500,
});
const FROZEN_LOAN = debt({ ...HEALTHY_LOAN, id: 'frozen-loan', frozenSince: DROPPED });

const OPTS = { figureLabel: 'this payoff plan', nextStep: 'accounts-route' } as const;
const CARD_SENTENCE = `Your bank stopped sharing Chase Sapphire on ${DROPPED_LONG}, so the balance behind this payoff plan is the last one we saw — nothing that has happened on the card since is in it, including any payment you have made or any new charge, so the real balance may be higher or lower than the one used here. Accounts shows the connection and how to fix or remove it.`;
const LOAN_SENTENCE = `Your bank stopped sharing Auto Loan on ${DROPPED_LONG}, so the balance behind this payoff plan is the last one it sent — any payment you have made since is not taken off it, so the real balance may be lower than the one used here. Accounts shows the connection and how to fix or remove it.`;

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('frozenDebtPlanNote — the sentence, per kind', () => {
  it('a card: both directions, because charges AND payments have gone unseen', () => {
    expect(
      frozenDebtPlanNote([{ label: 'Chase Sapphire', frozenSince: DROPPED, kind: 'card' }], OPTS),
    ).toBe(CARD_SENTENCE);
  });

  it('a loan: one direction, because a loan only ever goes down', () => {
    expect(
      frozenDebtPlanNote([{ label: 'Auto Loan', frozenSince: DROPPED, kind: 'loan' }], OPTS),
    ).toBe(LOAN_SENTENCE);
  });

  it('a card and a loan are two claims, never one sentence true of neither', () => {
    expect(
      frozenDebtPlanNote(
        [
          { label: 'Auto Loan', frozenSince: DROPPED, kind: 'loan' },
          { label: 'Chase Sapphire', frozenSince: DROPPED, kind: 'card' },
        ],
        OPTS,
      ),
    ).toBe(`${CARD_SENTENCE} ${LOAN_SENTENCE}`);
  });

  it('several cards name the set, and two that paint identically are said to', () => {
    expect(
      frozenDebtPlanNote(
        [
          { label: 'CREDIT CARD', frozenSince: DROPPED, kind: 'card' },
          { label: 'CREDIT CARD', frozenSince: '2026-06-01', kind: 'card' },
        ],
        OPTS,
      ),
    ).toBe(
      'Your banks stopped sharing 2 of the cards behind this payoff plan (all of them named “CREDIT CARD”), so their balances are the last ones we saw — nothing that has happened on them since is in this payoff plan, including payments you have made or new charges, so the real balances may be higher or lower than the ones used here. Accounts shows the connection and how to fix or remove them.',
    );
  });

  it('several loans', () => {
    expect(
      frozenDebtPlanNote(
        [
          { label: 'Auto Loan', frozenSince: DROPPED, kind: 'loan' },
          { label: 'Student Loan', frozenSince: DROPPED, kind: 'loan' },
        ],
        { figureLabel: 'the total debt and the extra needed to clear it', nextStep: 'accounts-route' },
      ),
    ).toBe(
      'Your banks stopped sharing 2 of the loans behind the total debt and the extra needed to clear it (Auto Loan, Student Loan), so their balances are the last ones sent — payments you have made since are not taken off them, so the real balances may be lower than the ones used here. Accounts shows the connection and how to fix or remove them.',
    );
  });

  it('no frozen debt → null, so an unaffected surface is byte-identical', () => {
    expect(frozenDebtPlanNote([], OPTS)).toBeNull();
  });

  it('the label is sanitised like every other sentence in the file (bidi/zero-width stripped)', () => {
    // U+202E reverses the rest of the line at paint time; U+200B is invisible. `renderSafe`
    // strips both, so the sentence paints the same characters it was compared on.
    expect(
      frozenDebtPlanNote(
        [{ label: 'Chase\u200B \u202ESapphire', frozenSince: DROPPED, kind: 'card' }],
        OPTS,
      ),
    ).toBe(CARD_SENTENCE);
    expect(frozenDebtPlanNote([{ label: '\u200B', frozenSince: DROPPED, kind: 'card' }], OPTS)).toContain(
      'Unnamed account',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('loadDebtAccounts — the fact rides the money, and no figure moves', () => {
  const U = `l19-debt-${Date.now()}-${process.pid}`;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
    await prisma.user.create({ data: { id: U, email: `${U}@test.local` } });
    const mk = (
      name: string,
      type: string,
      balance: number,
      dropped: string | null,
      extra: { aprBps?: number; minimumPaymentCents?: number } = {},
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
    await mk('Chase Sapphire', 'CREDIT', 900_000, DROPPED, { aprBps: 2_399 });
    await mk('Auto Loan', 'LOAN', 1_430_000, null, { aprBps: 649, minimumPaymentCents: 38_500 });
    // A frozen card that owes nothing is in no plan — and so must be in no disclosure.
    await mk('Paid Off Card', 'CREDIT', 0, DROPPED, { aprBps: 1_999 });
    // A mortgage is out of the snowball by convention (BS6, not BS2), frozen or not.
    await mk('Home Mortgage', 'MORTGAGE', 32_000_000, DROPPED, { aprBps: 650 });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: U } });
  });

  it('carries frozenSince and kind verbatim on the debts it returns, and only on those', async () => {
    const debts = await loadDebtAccounts(U);
    expect(debts.map((d) => [d.name, d.kind, d.frozenSince])).toEqual([
      ['Chase Sapphire', 'card', DROPPED],
      ['Auto Loan', 'loan', null],
    ]);
  });

  it('DISCLOSE, ADJUST NOTHING: the plan is identical with the stamp and with it stripped', async () => {
    const debts = await loadDebtAccounts(U);
    const stripped = debts.map((d) => ({
      id: d.id,
      name: d.name,
      balanceCents: d.balanceCents,
      aprBps: d.aprBps,
      minimumPaymentCents: d.minimumPaymentCents,
    }));
    for (const strategy of ['avalanche', 'snowball'] as const) {
      expect(planDebtPayoff({ debts, strategy, extraMonthlyCents: 5_000 })).toEqual(
        planDebtPayoff({ debts: stripped, strategy, extraMonthlyCents: 5_000 }),
      );
    }
    expect(
      solveDebtFreeByDate({
        debts,
        strategy: 'avalanche',
        targetDate: isoDate('2027-06-30'),
        today: TODAY,
        safeToSpendCents: 75_000,
      }),
    ).toEqual(
      solveDebtFreeByDate({
        debts: stripped,
        strategy: 'avalanche',
        targetDate: isoDate('2027-06-30'),
        today: TODAY,
        safeToSpendCents: 75_000,
      }),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('Ask — "when am I debt-free?"', () => {
  const GOLDEN_DETAIL =
    'Snowball (smallest balance first) is one tap away on the planner if momentum matters more.';

  it('names the frozen card inside the plan, after the strategy line, and no healthy sibling', () => {
    const debts = [FROZEN_CARD, HEALTHY_LOAN];
    const plan = planDebtPayoff({ debts, strategy: 'avalanche', extraMonthlyCents: 0 });
    const a = answerDebtPayoff(plan, TODAY, debts);
    expect(a.detail).toBe(`${GOLDEN_DETAIL} ${CARD_SENTENCE}`);
    expect(a.detail).not.toContain('Auto Loan');
    // The figures themselves are the engine's, untouched.
    expect(a.facts).toContainEqual({ label: 'Months', value: String(plan.monthsToDebtFree) });
  });

  it('a plan that never clears still carries the note — a frozen balance is WHY it may not', () => {
    // 0 minimum, 0 extra: nothing is ever paid, so the plan reports "never".
    const debts = [debt({ ...FROZEN_LOAN, minimumPaymentCents: 0 })];
    const plan = planDebtPayoff({ debts, strategy: 'avalanche', extraMonthlyCents: 0 });
    expect(plan.monthsToDebtFree).toBeNull();
    const a = answerDebtPayoff(plan, TODAY, debts);
    expect(a.detail).toBe(LOAN_SENTENCE);
  });

  it('with nothing frozen the answer is the GOLDEN one — no caveat appears from nowhere', () => {
    const debts = [debt({ ...FROZEN_CARD, frozenSince: null }), HEALTHY_LOAN];
    const plan = planDebtPayoff({ debts, strategy: 'avalanche', extraMonthlyCents: 0 });
    const a = answerDebtPayoff(plan, TODAY, debts);
    expect(a.detail).toBe(GOLDEN_DETAIL);
    expect(JSON.stringify(a)).not.toContain('stopped sharing');
  });

  it('no debts, no note — there is no plan for a frozen balance to be behind', () => {
    const a = answerDebtPayoff(
      planDebtPayoff({ debts: [], strategy: 'avalanche', extraMonthlyCents: 0 }),
      TODAY,
      [],
    );
    expect(a.detail).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('Ask — "be debt-free by <date>"', () => {
  const BY_DATE_LABEL = 'the total debt and the extra needed to clear it';
  const BY_DATE_CARD = CARD_SENTENCE.replace('this payoff plan', BY_DATE_LABEL);
  const solve = (debts: readonly DebtAccount[], targetDate: string, safeToSpendCents = 75_000) =>
    solveDebtFreeByDate({
      debts,
      strategy: 'avalanche',
      targetDate: isoDate(targetDate),
      today: TODAY,
      safeToSpendCents,
    });

  it('the reachable branch: the extra-per-month is qualified, the figures are untouched', () => {
    const debts = [FROZEN_CARD, HEALTHY_LOAN];
    const r = solve(debts, '2027-06-30');
    expect(r.outcome).toBe('reachable');
    const a = answerDebtFreeByDate(r, 'June 2027', '2027-06-30', TODAY, 0, debts);
    expect(a.detail?.endsWith(` ${BY_DATE_CARD}`)).toBe(true);
    expect(a.detail).not.toContain('Auto Loan');
    expect(a.facts).toContainEqual({
      label: 'Extra needed',
      value: `$${(r.requiredExtraMonthlyCents! / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}/mo`,
    });
    // The save action survives: DISCLOSE, never wall off (a-refusal-learns-one-intention).
    expect(a.action?.kind).toBe('save_debt_free_goal');
  });

  it('the unreachable branch prints the total debt, so it too is qualified', () => {
    const debts = [FROZEN_CARD];
    const r = solve(debts, '2026-06-30');
    expect(r.outcome).toBe('unreachable');
    const a = answerDebtFreeByDate(r, 'June 2026', '2026-06-30', TODAY, 0, debts);
    expect(a.detail).toBe(`Try a later date and I’ll work out the payment it would take. ${BY_DATE_CARD}`);
  });

  it('a frozen debt with NO balance is outside the total, so it is not named (the Σ max(0,·) rule)', () => {
    const debts = [debt({ ...FROZEN_CARD, balanceCents: 0 }), HEALTHY_LOAN];
    const r = solve(debts, '2027-06-30');
    const a = answerDebtFreeByDate(r, 'June 2027', '2027-06-30', TODAY, 0, debts);
    expect(a.detail).not.toContain('stopped sharing');
  });

  it('with nothing frozen the reachable answer is the GOLDEN one', () => {
    const debts = [debt({ ...FROZEN_CARD, frozenSince: null })];
    const r = solve(debts, '2027-06-30');
    expect(r.outcome).toBe('reachable');
    // $9,000 at 23.99% in 12 months needs more than one month's $750 safe-to-spend, so this is the
    // beyond-a-single-month's-budget branch; its detail is pinned verbatim from the pre-L.19 output.
    expect(r.withinSafeToSpend).toBe(false);
    const a = answerDebtFreeByDate(r, 'June 2027', '2027-06-30', TODAY, 0, debts);
    expect(a.detail).toBe(
      'A later date would ask less of your budget each month. Illustration, not advice — assumes the least-interest (avalanche) order and APRs as entered.',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('/goals — the planner renders the note, resolved against the list it prints', () => {
  it('test_regression__debt_planner_names_a_frozen_balance_behind_its_date', () => {
    const planner = readFileSync(resolve('src/components/finance/debt-freedom-planner.tsx'), 'utf8');
    expect(planner).toContain('frozenDebtPlanNote(');
    expect(planner).toContain(`data-testid={FROZEN_DEBT_PLAN_TESTID}`);
    expect(FROZEN_DEBT_PLAN_TESTID).toBe('debt-planner-frozen');
    // Resolved against the rows the order list prints, not the prop (the L.15 rule).
    expect(planner).toContain('active.perDebt.map((d) => d.id)');
    // The planner is typed to the READ PATH's shape, so the compiler asks for the fact.
    expect(planner).toContain('debts: DebtAccount[];');
    const page = readFileSync(resolve('src/app/(app)/goals/page.tsx'), 'utf8');
    expect(page).toContain('loadDebtAccounts(userId)');
  });
});
