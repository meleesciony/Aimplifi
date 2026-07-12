/**
 * Weekly digest builder (Gap 2 §3) — known-answer tests for the pure composition.
 * Fixtures are a hand-built MoneyReview + PaymentReminders, so these are seed-
 * independent. today = 2026-06-10. Every figure is copied verbatim from the source;
 * the digest reconciles with /coach (review) and the reminder surface (dues) by reusing
 * the same objects and the shared `reminderLine`.
 */
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';
import type { MoneyReview } from '@/lib/engine/fi/coach-copy';
import { type PaymentReminder, reminderLine } from '@/lib/engine/reminders/select';
import { buildWeeklyDigest } from '@/lib/engine/digest/build';

const TODAY = isoDate('2026-06-10');

const REVIEW: MoneyReview = {
  month: '2026-05',
  improvement: 'Your savings rate improved from 18% to 32% in May 2026.',
  creep: 'What held steady: discretionary spending is flat.',
  nextAction: 'One next action: move $500.00 to checking by Jun 15 so every card clears in full.',
};

function reminder(p: {
  accountId: string;
  accountName: string;
  dueDate: string;
  daysUntil: number;
  userActionCents?: number;
  autopayCents?: number;
  isEstimated?: boolean;
}): PaymentReminder {
  const userAction = p.userActionCents ?? 45000;
  return {
    accountId: p.accountId,
    accountName: p.accountName,
    obligationType: 'card',
    dueDate: isoDate(p.dueDate),
    daysUntil: p.daysUntil,
    urgency: p.daysUntil === 0 ? 'today' : p.daysUntil <= 3 ? 'soon' : 'upcoming',
    cashRequiredCents: cents(userAction),
    userActionCents: cents(userAction),
    autopayCents: cents(p.autopayCents ?? 0),
    autopayCovered: userAction === 0 && (p.autopayCents ?? 0) > 0,
    isEstimated: p.isEstimated ?? false,
  };
}

describe('buildWeeklyDigest', () => {
  it('composes the review + dues verbatim, reusing the shared reminder line', () => {
    const dues = [reminder({ accountId: 'a1', accountName: 'Sapphire', dueDate: '2026-06-15', daysUntil: 5 })];
    const digest = buildWeeklyDigest({ review: REVIEW, reminders: dues, today: TODAY });
    expect(digest).not.toBeNull();
    expect(digest!.subject).toBe('Your week with Aimplifi');
    // Review lines copied verbatim (no recomputation).
    expect(digest!.text).toContain(REVIEW.improvement);
    expect(digest!.text).toContain(REVIEW.creep);
    expect(digest!.text).toContain(REVIEW.nextAction);
    // The due renders through the SHARED reminderLine (identical to the reminder email).
    expect(digest!.text).toContain(reminderLine(dues[0]));
    expect(digest!.text).toContain('Coming up in the next 7 days:');
    expect(digest!.text).toContain('never moves your money');
  });

  it('shows a clear-week line when nothing is due', () => {
    const digest = buildWeeklyDigest({ review: REVIEW, reminders: [], today: TODAY });
    expect(digest!.text).toContain('Nothing due in the next 7 days');
    expect(digest!.text).not.toContain('•');
  });

  it('still sends with dues even when there is no review', () => {
    const dues = [reminder({ accountId: 'a1', accountName: 'Freedom', dueDate: '2026-06-12', daysUntil: 2 })];
    const digest = buildWeeklyDigest({ review: null, reminders: dues, today: TODAY });
    expect(digest).not.toBeNull();
    expect(digest!.text).toContain('Freedom');
    // No review → no improvement/creep lines.
    expect(digest!.text).not.toContain('savings rate');
  });

  it('returns null when there is genuinely nothing to say', () => {
    expect(buildWeeklyDigest({ review: null, reminders: [], today: TODAY })).toBeNull();
  });

  it('marks an estimated due', () => {
    const dues = [reminder({ accountId: 'a1', accountName: 'Store Card', dueDate: '2026-06-14', daysUntil: 4, isEstimated: true })];
    const digest = buildWeeklyDigest({ review: REVIEW, reminders: dues, today: TODAY });
    expect(digest!.text).toContain('[estimated]');
  });

  // Wave 1.3 — the cumulative "what Aimplifi caught" tally, via the SHARED receiptLines.
  it('renders the receipts tally through the same lines the /coach card shows', () => {
    const receipts = {
      total: 4,
      remindersCount: 2,
      remindersAmountCents: cents(173456),
      radarCount: 1,
      priceIncreaseCount: 1,
      priceIncreaseMonthlyCents: cents(250),
    };
    const digest = buildWeeklyDigest({ review: REVIEW, reminders: [], today: TODAY, receipts });
    expect(digest!.text).toContain('running tally of what Aimplifi has caught');
    expect(digest!.text).toContain('2 payment reminders delivered, covering $1,734.56 in payments due.');
    expect(digest!.text).toContain('1 early warning before checking was projected to dip below $0.');
    expect(digest!.text).toContain('1 quiet price increase flagged — $2.50/mo in total.');
  });

  it('an all-zero or absent tally adds nothing, and receipts alone never trigger a digest', () => {
    const zero = {
      total: 0,
      remindersCount: 0,
      remindersAmountCents: cents(0),
      radarCount: 0,
      priceIncreaseCount: 0,
      priceIncreaseMonthlyCents: cents(0),
    };
    const withZero = buildWeeklyDigest({ review: REVIEW, reminders: [], today: TODAY, receipts: zero });
    expect(withZero!.text).not.toContain('caught');
    // No review + nothing due → null even with a non-zero tally (a tally alone isn't news).
    const tallyOnly = buildWeeklyDigest({
      review: null,
      reminders: [],
      today: TODAY,
      receipts: { ...zero, total: 3, priceIncreaseCount: 3, priceIncreaseMonthlyCents: cents(900) },
    });
    expect(tallyOnly).toBeNull();
  });
});

/**
 * TASKS 4.2 slice 7 — the JOINT household digest (DECISIONS #201(2) / #220).
 * The composer is the whole household surface here: presence of `household`
 * flips the subject + dues header and appends the shared-movement block with the
 * §4.4 assumptions copy. Absence of it must leave the pre-slice-7 personal digest
 * byte-identical (T6).
 */
describe('buildWeeklyDigest — joint household digest', () => {
  const MOVEMENT = {
    accountCount: 2,
    transactionCount: 14,
    outflowCents: cents(124_055),
    inflowCents: cents(500_00),
  };
  const HOUSEHOLD = {
    name: 'The Nguyens',
    movement: MOVEMENT,
    partnerAccountLabels: {},
    withheldAccountCount: 0,
  };

  it('household context flips the subject and dues header, and states its assumptions inline', () => {
    const dues = [reminder({ accountId: 'a1', accountName: "Partner's Sapphire", dueDate: '2026-06-15', daysUntil: 5 })];
    const digest = buildWeeklyDigest({ review: REVIEW, reminders: dues, today: TODAY, household: HOUSEHOLD });

    expect(digest!.subject).toBe("Your household's week with Aimplifi");
    expect(digest!.text).toContain('Coming up in the next 7 days across your household:');
    // Household-scope dues still render through the SHARED reminderLine.
    expect(digest!.text).toContain(reminderLine(dues[0]));
    expect(digest!.text).toContain('Shared in The Nguyens:');
    expect(digest!.text).toContain('14 transactions on 2 shared accounts in the last 7 days — $1,240.55 out, $500.00 in.');
    // The joint number never implies completeness (§4.4 guardrail).
    expect(digest!.text).toContain("Anything not shared isn't counted.");
    // …and the personal review inside it is disclosed as personal (§4.5).
    expect(digest!.text).toContain('Your partner\'s copy of this email shows theirs, never yours.');
  });

  it('names no merchant and no partner — descriptive, never a verdict on a partner (§4.5)', () => {
    const digest = buildWeeklyDigest({ review: REVIEW, reminders: [], today: TODAY, household: HOUSEHOLD });
    const shared = digest!.text.slice(digest!.text.indexOf('Shared in'));
    // The movement block is a count and two totals. Nothing else about the rows.
    expect(shared).not.toMatch(/spent|overspent|too much|your partner spent/i);
  });

  it('a quiet week on shared accounts says so, without rendering "0 shared accounts"', () => {
    const digest = buildWeeklyDigest({
      review: REVIEW,
      reminders: [],
      today: TODAY,
      household: { ...HOUSEHOLD, movement: { ...MOVEMENT, transactionCount: 0, outflowCents: cents(0), inflowCents: cents(0) } },
    });
    expect(digest!.text).toContain('No transactions on the 2 shared accounts in the last 7 days.');
    expect(digest!.text).not.toContain('0 shared account');
  });

  it('partners but nothing shared: says the email counts only your own accounts', () => {
    const digest = buildWeeklyDigest({
      review: REVIEW,
      reminders: [],
      today: TODAY,
      household: { ...HOUSEHOLD, movement: { accountCount: 0, transactionCount: 0, outflowCents: cents(0), inflowCents: cents(0) } },
    });
    expect(digest!.text).toContain('No accounts are shared in The Nguyens yet, so this email counts only your own.');
    expect(digest!.text).not.toContain('transactions on the 0 shared');
  });

  it('household context is NEVER a send trigger on its own (parity with receipts)', () => {
    expect(
      buildWeeklyDigest({ review: null, reminders: [], today: TODAY, household: HOUSEHOLD }),
    ).toBeNull();
  });

  /**
   * Slice-7 critic F1 (P1, fail-old/pass-new). The personal `reminderLine` is
   * second-person ("you'll pay $600 yourself" / "keep the funds in your account").
   * Rendering it for a PARTNER's shared card tells the reader they must pay someone
   * else's bill — false, and an invitation for both partners to pay it.
   */
  describe("a partner's shared card is owner-attributed, never billed to the reader (critic F1)", () => {
    const partnerDue = reminder({
      accountId: 'partner-card',
      accountName: 'Sapphire',
      dueDate: '2026-06-15',
      daysUntil: 5,
      userActionCents: 60_000,
    });
    const withPartner = { ...HOUSEHOLD, partnerAccountLabels: { 'partner-card': 'Sam' } };

    it('names the owner and never says the reader will pay it', () => {
      const digest = buildWeeklyDigest({
        review: REVIEW,
        reminders: [partnerDue],
        today: TODAY,
        household: withPartner,
      });
      const line = digest!.text.split('\n').find((l) => l.includes('Sapphire'))!;
      expect(line).toContain("Sapphire (Sam's)");
      // Same date/urgency phrasing as the personal line (shared `reminderWhen`).
      expect(line).toContain('$600.00 due Mon, Jun 15, 2026 (in 5 days)');
      expect(line).toContain("it's on Sam's account, not yours");
      expect(line).toContain("Aimplifi doesn't decide who pays");
      // The exact claims that made this a P1:
      expect(line).not.toContain("you'll pay");
      expect(line).not.toContain('yourself');
      expect(line).not.toContain('your account');
    });

    it('autopay on a partner card points at THEIR account, not the reader\'s', () => {
      const covered = { ...partnerDue, userActionCents: cents(0), autopayCents: cents(60_000), autopayCovered: true };
      const digest = buildWeeklyDigest({
        review: REVIEW,
        reminders: [covered],
        today: TODAY,
        household: withPartner,
      });
      const line = digest!.text.split('\n').find((l) => l.includes('Sapphire'))!;
      expect(line).toContain("the funds need to be in Sam's account");
      // The personal line would have said "just keep the funds in your account".
      expect(line).not.toContain('your account');
    });

    it("the reader's OWN card in the same digest keeps the personal line verbatim", () => {
      const mine = reminder({ accountId: 'my-card', accountName: 'Freedom', dueDate: '2026-06-13', daysUntil: 3 });
      const digest = buildWeeklyDigest({
        review: REVIEW,
        reminders: [mine, partnerDue],
        today: TODAY,
        household: withPartner,
      });
      expect(digest!.text).toContain(reminderLine(mine)); // byte-identical
      expect(digest!.text).not.toContain(reminderLine(partnerDue)); // never for the partner's
    });
  });

  it('a currency-withheld shared account is disclosed, never silently dropped (critic F3)', () => {
    const onlyForeign = buildWeeklyDigest({
      review: REVIEW,
      reminders: [],
      today: TODAY,
      household: {
        ...HOUSEHOLD,
        movement: { accountCount: 0, transactionCount: 0, outflowCents: cents(0), inflowCents: cents(0) },
        withheldAccountCount: 1,
      },
    });
    // "Nothing is shared yet" would be a lie — something IS shared, in EUR.
    expect(onlyForeign!.text).not.toContain('No accounts are shared');
    expect(onlyForeign!.text).toContain("1 shared account isn't counted above");

    const alsoForeign = buildWeeklyDigest({
      review: REVIEW,
      reminders: [],
      today: TODAY,
      household: { ...HOUSEHOLD, withheldAccountCount: 2 },
    });
    expect(alsoForeign!.text).toContain('14 transactions on 2 shared accounts');
    expect(alsoForeign!.text).toContain("2 shared accounts aren't counted above");
  });

  it('T6: without household context the digest is byte-identical to the personal one', () => {
    const dues = [reminder({ accountId: 'a1', accountName: 'Sapphire', dueDate: '2026-06-15', daysUntil: 5 })];
    const personal = buildWeeklyDigest({ review: REVIEW, reminders: dues, today: TODAY });
    for (const absent of [undefined, null] as const) {
      const same = buildWeeklyDigest({ review: REVIEW, reminders: dues, today: TODAY, household: absent });
      expect(same).toEqual(personal);
    }
    expect(personal!.text).not.toContain('Shared in');
    expect(personal!.text).not.toContain('household');
  });
});
