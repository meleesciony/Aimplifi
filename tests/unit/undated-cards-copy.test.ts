/**
 * test_regression__no_surface_claims_nothing_is_due_while_a_card_is_undatable
 * (hostile-critic findings F-1/F-2/F-3, owner-reported 2026-07-23).
 *
 * The first pass at this fix corrected the dashboard hero and /cards, and left the
 * IDENTICAL false all-clear standing on every other surface fed by the same
 * now-known-incomplete obligation set — the #221 lesson exactly: when a data class
 * is widened (here: "cards" no longer means "all the user's cards"), every consumer
 * has to be re-read, not just the one that reported the bug.
 *
 * Surfaces locked here: the Ask assistant answer, and the weekly digest EMAIL —
 * the email matters most, because it is the one place the user cannot see the
 * in-app panel that corrects the claim.
 */
import { describe, expect, it } from 'vitest';
import { answerCashNeeded } from '@/lib/engine/assistant/answer';
import { computeCashNeeded } from '@/lib/engine/cash-needed/engine';
import type { CardSnapshot, CashNeededInput } from '@/lib/engine/cash-needed/types';
import { buildWeeklyDigest } from '@/lib/engine/digest/build';
import { isoDate } from '@/lib/dates';
import { cents } from '@/lib/money';

const TODAY = isoDate('2026-07-23');

function input(cards: CardSnapshot[]): CashNeededInput {
  return {
    today: TODAY,
    paymentAccount: { name: 'Everyday Checking', balanceCents: cents(250000), pending: [] },
    cards,
    scheduled: [],
    scenario: 'PAY_IN_FULL',
    holidayTable: [],
  };
}

const undatable: CardSnapshot = {
  id: 'card-chase',
  name: 'Chase Sapphire',
  aprBps: 2499,
  autopay: null,
  statement: null,
  currentBalanceCents: cents(184267),
  paymentsAppliedCents: cents(0),
};

const dated: CardSnapshot = {
  id: 'card-amex',
  name: 'Amex Gold',
  aprBps: 2199,
  autopay: null,
  statement: {
    statementBalanceCents: cents(50000),
    minimumPaymentCents: cents(3500),
    dueDate: isoDate('2026-08-05'),
    cycleEnd: isoDate('2026-07-10'),
  },
  currentBalanceCents: cents(50000),
  paymentsAppliedCents: cents(0),
};

describe('Ask assistant — cash needed', () => {
  it('does NOT answer "nothing due" when the only card is undatable', () => {
    const answer = answerCashNeeded(computeCashNeeded(input([undatable])), 'Everyday Checking');
    expect(answer.headline).not.toContain('nothing due on your cards');
    expect(answer.headline).toMatch(/no statement or due date yet/i);
    expect(answer.facts.some((f) => f.value.includes('Chase Sapphire'))).toBe(true);
  });

  it('still answers "nothing due" when there is genuinely nothing outstanding', () => {
    const answer = answerCashNeeded(computeCashNeeded(input([])), 'Everyday Checking');
    expect(answer.headline).toBe('You have nothing due on your cards this cycle.');
    expect(answer.facts).toEqual([]);
  });

  it('does not claim a real figure covers "your cards" when one is undatable', () => {
    const answer = answerCashNeeded(
      computeCashNeeded(input([dated, undatable])),
      'Everyday Checking',
    );
    expect(answer.headline).toContain('the cards I can date');
    expect(answer.headline).not.toMatch(/to pay your cards in full/);
    expect(answer.facts.some((f) => f.label === 'No due date yet')).toBe(true);
  });

  it('keeps the plain wording when every card is datable', () => {
    const answer = answerCashNeeded(computeCashNeeded(input([dated])), 'Everyday Checking');
    expect(answer.headline).toContain('to pay your cards in full');
    expect(answer.facts.some((f) => f.label === 'No due date yet')).toBe(false);
  });
});

describe('weekly digest email', () => {
  const review = {
    improvement: 'You spent less on dining out.',
    creep: 'Subscriptions crept up by $12.',
    nextAction: 'Review the two new subscriptions.',
  } as Parameters<typeof buildWeeklyDigest>[0]['review'];

  it('does NOT promise "a clear week ahead" while cards are undatable', () => {
    const digest = buildWeeklyDigest({
      review,
      reminders: [],
      today: TODAY,
      undatedCardCount: 2,
    });
    expect(digest).not.toBeNull();
    expect(digest!.text).not.toContain('a clear week ahead');
    expect(digest!.text).toContain('on the cards we can date');
    expect(digest!.text).toContain('2 cards have no statement or due date yet');
  });

  it('still promises a clear week when nothing is undatable', () => {
    const digest = buildWeeklyDigest({ review, reminders: [], today: TODAY });
    expect(digest!.text).toContain('a clear week ahead');
  });

  it('uses singular wording for one undatable card', () => {
    const digest = buildWeeklyDigest({
      review,
      reminders: [],
      today: TODAY,
      undatedCardCount: 1,
    });
    expect(digest!.text).toContain('One card has no statement or due date yet');
  });

  it('an undatable card alone is NOT a reason to send an email', () => {
    // Same rule as receipts: a digest with no review and nothing due stays null.
    expect(
      buildWeeklyDigest({ review: null, reminders: [], today: TODAY, undatedCardCount: 3 }),
    ).toBeNull();
  });
});

/**
 * cycle-2 critic P1-2 / P2-6: the MIXED case — something IS due AND a card can't be
 * dated. A list of what's due reads as complete, so the omission has to be named
 * next to it. This was the branch with no coverage at all.
 */
describe('weekly digest email — mixed case', () => {
  const review = {
    improvement: 'You spent less on dining out.',
    creep: 'Subscriptions crept up by $12.',
    nextAction: 'Review the two new subscriptions.',
  } as Parameters<typeof buildWeeklyDigest>[0]['review'];

  const reminder = {
    accountId: 'card-amex',
    accountName: 'Amex Gold',
    dueDate: isoDate('2026-07-27'),
    daysUntil: 4,
    cashRequiredCents: cents(50000),
    userActionCents: cents(50000),
    autopayCents: cents(0),
    autopayCovered: false,
    isEstimated: false,
  } as unknown as Parameters<typeof buildWeeklyDigest>[0]['reminders'][number];

  it('names the undated cards even when other cards ARE due', () => {
    const digest = buildWeeklyDigest({
      review,
      reminders: [reminder],
      today: TODAY,
      undatedCardCount: 2,
    });
    expect(digest!.text).toContain('Amex Gold'); // the real due still shows
    expect(digest!.text).toContain('Not shown above');
    expect(digest!.text).toContain('2 cards have no statement or due date yet');
  });

  it('adds nothing when every card is datable', () => {
    const digest = buildWeeklyDigest({ review, reminders: [reminder], today: TODAY });
    expect(digest!.text).not.toContain('Not shown above');
  });

  it('uses singular wording for one undated card alongside a due', () => {
    const digest = buildWeeklyDigest({
      review,
      reminders: [reminder],
      today: TODAY,
      undatedCardCount: 1,
    });
    expect(digest!.text).toContain('one card has no statement or due date yet');
    expect(digest!.text).toContain('nothing about it is included here.');
  });
});
