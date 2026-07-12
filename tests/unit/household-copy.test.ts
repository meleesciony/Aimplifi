/**
 * Household copy guardrails (TASKS 4.2 slice 5 — cross-app copy audit).
 * Same rules as tests/unit/coach-copy.test.ts, applied to HOUSEHOLD_COPY
 * (src/lib/copy/household-copy.ts): zero shame language, and every consent/
 * disclosure string states what is and isn't shared inline. The BANNED list
 * is duplicated (not imported) from coach-copy.test.ts — both are independent
 * small literals, not worth a shared module for nine regexes.
 */
import { describe, expect, it } from 'vitest';
import { HOUSEHOLD_COPY } from '@/lib/copy/household-copy';
import { cents } from '@/lib/money';

const ALL_STRINGS: { label: string; text: string }[] = [
  { label: 'teamSportTagline', text: HOUSEHOLD_COPY.teamSportTagline() },
  { label: 'disclosure', text: HOUSEHOLD_COPY.disclosure() },
  { label: 'inviteCodeHint', text: HOUSEHOLD_COPY.inviteCodeHint() },
  { label: 'inviteCodeIssued', text: HOUSEHOLD_COPY.inviteCodeIssued('partner@example.com') },
  { label: 'inviteFormHint', text: HOUSEHOLD_COPY.inviteFormHint() },
  { label: 'leaveConfirm', text: HOUSEHOLD_COPY.leaveConfirm('Our household') },
  { label: 'sharedWithYouDisclosure', text: HOUSEHOLD_COPY.sharedWithYouDisclosure() },
  { label: 'noAccountsToShare', text: HOUSEHOLD_COPY.noAccountsToShare() },
  { label: 'shareYourAccountsDisclosure', text: HOUSEHOLD_COPY.shareYourAccountsDisclosure() },
  { label: 'sharedTxnDisclosure', text: HOUSEHOLD_COPY.sharedTxnDisclosure() },
  { label: 'sharedTxnTruncated', text: HOUSEHOLD_COPY.sharedTxnTruncated(100) },
  { label: 'sharedTxnRecatHint', text: HOUSEHOLD_COPY.sharedTxnRecatHint() },
  { label: 'scopeAssumptions', text: HOUSEHOLD_COPY.scopeAssumptions() },
  // TASKS 4.2 slice 7 — joint household digest (DECISIONS #201(2)).
  { label: 'digestSubject', text: HOUSEHOLD_COPY.digestSubject() },
  { label: 'digestPaymentsHeader', text: HOUSEHOLD_COPY.digestPaymentsHeader() },
  { label: 'digestSharedHeader', text: HOUSEHOLD_COPY.digestSharedHeader('Our household') },
  {
    label: 'digestMovement',
    text: HOUSEHOLD_COPY.digestMovement(14, 2, cents(124_055), cents(50_000)),
  },
  {
    label: 'digestPartnerDue',
    text: HOUSEHOLD_COPY.digestPartnerDue({
      accountName: 'Sapphire',
      ownerLabel: 'Sam',
      cashRequiredCents: cents(60_000),
      userActionCents: cents(60_000),
      autopayCents: cents(0),
      autopayCovered: false,
      dueDateLong: 'June 15, 2026',
      when: 'in 5 days',
      isEstimated: false,
    }),
  },
  { label: 'digestUnsupportedCurrency', text: HOUSEHOLD_COPY.digestUnsupportedCurrency(1) },
  { label: 'digestNoMovement', text: HOUSEHOLD_COPY.digestNoMovement(2) },
  { label: 'digestNothingShared', text: HOUSEHOLD_COPY.digestNothingShared('Our household') },
  { label: 'digestPrivacyNote', text: HOUSEHOLD_COPY.digestPrivacyNote() },
  // TASKS 4.2 slice 8 — full-surface hostile critic fixes (F-1..F-6).
  { label: 'headlineAcrossHousehold', text: HOUSEHOLD_COPY.headlineAcrossHousehold('Our household') },
  { label: 'reminderPartnerAutopayCovered', text: HOUSEHOLD_COPY.reminderPartnerAutopayCovered('Sam') },
  {
    label: 'reminderPartnerPartialAutopay',
    text: HOUSEHOLD_COPY.reminderPartnerPartialAutopay('Sam', cents(40_000), cents(20_000)),
  },
  { label: 'reminderPartnerManual', text: HOUSEHOLD_COPY.reminderPartnerManual('Sam') },
  { label: 'cardsPartnerToPayLabel', text: HOUSEHOLD_COPY.cardsPartnerToPayLabel() },
  { label: 'cardsPartnerDueNote', text: HOUSEHOLD_COPY.cardsPartnerDueNote('Sam') },
  { label: 'cardsPartnerAutopayCovered', text: HOUSEHOLD_COPY.cardsPartnerAutopayCovered('Sam') },
  {
    label: 'cardsPartnerPartialAutopay',
    text: HOUSEHOLD_COPY.cardsPartnerPartialAutopay('Sam', cents(40_000), cents(20_000)),
  },
  {
    label: 'cardsDueFirstPartner',
    text: HOUSEHOLD_COPY.cardsDueFirstPartner({
      cardName: 'Sapphire',
      ownerLabel: 'Sam',
      amountCents: cents(43_400),
      dateLong: 'June 15, 2026',
      when: 'in 5 days',
    }),
  },
  { label: 'scopeUnsupportedCurrency', text: HOUSEHOLD_COPY.scopeUnsupportedCurrency(1) },
  { label: 'householdDuplicateTitle', text: HOUSEHOLD_COPY.householdDuplicateTitle() },
  {
    label: 'householdDuplicatePair',
    text: HOUSEHOLD_COPY.householdDuplicatePair('Chase Checking', 'yours', 'CHASE Checking', "Sam's"),
  },
  { label: 'householdDuplicateFooter', text: HOUSEHOLD_COPY.householdDuplicateFooter() },
  { label: 'digestNoSpendingShared', text: HOUSEHOLD_COPY.digestNoSpendingShared(1) },
  { label: 'digestDuplicateWarning', text: HOUSEHOLD_COPY.digestDuplicateWarning(1) },
];

const BANNED = [
  /you wasted/i,
  /stop buying/i,
  /\bguilty\b/i,
  /\bshame\b/i,
  /you should have/i,
  /\bsplurg/i,
  /cut back on your latte/i,
  /\birresponsib/i,
  /\bbad with money\b/i,
];

const DISCLOSURE_LABELS = new Set([
  'disclosure',
  'sharedWithYouDisclosure',
  'shareYourAccountsDisclosure',
  'sharedTxnDisclosure',
  'scopeAssumptions',
  // Slice 7: every line of the joint digest that carries household data must
  // say, in the same breath, what it does and does not count.
  'digestMovement',
  'digestNoMovement',
  'digestNothingShared',
  'digestPrivacyNote',
  'digestPartnerDue',
  'digestUnsupportedCurrency',
  // Slice 8: the new household-scope disclosures carry the same duty.
  'scopeUnsupportedCurrency',
  'cardsPartnerDueNote',
  'digestNoSpendingShared',
  'digestDuplicateWarning',
  'householdDuplicateFooter',
]);

/**
 * Slice-7 critic F1: the personal reminder line is second-person by construction.
 * A partner-owned due must never claim the reader pays it, or that the money must
 * sit in the reader's account — the two phrasings that would invite a double payment.
 */
const PARTNER_DUE_BANNED = [/you'll pay/i, /\byourself\b/i, /your account/i];

describe('household copy guardrails — zero shame, disclosures state what is/isn\'t shared', () => {
  it.each(ALL_STRINGS.map((s) => [s.label, s] as const))('%s: no shame language', (_, s) => {
    for (const banned of BANNED) {
      expect(s.text, `"${s.text}" must not match ${banned}`).not.toMatch(banned);
    }
  });

  it.each(
    ALL_STRINGS.filter((s) => DISCLOSURE_LABELS.has(s.label)).map((s) => [s.label, s] as const),
  )('%s: states what is / is not shared', (_, s) => {
    expect(s.text).toMatch(/shar|not their full picture|anything not shared/i);
  });

  it('every string is non-empty', () => {
    for (const s of ALL_STRINGS) expect(s.text.length).toBeGreaterThan(0);
  });

  /**
   * The scan is EXHAUSTIVE over HOUSEHOLD_COPY (slice 7): a new household string
   * cannot ship unscanned because someone forgot to add it to ALL_STRINGS above.
   * Before this lock the list was hand-maintained and silently incomplete-able.
   */
  it('scans every key of HOUSEHOLD_COPY — no household string ships unscanned', () => {
    expect(new Set(ALL_STRINGS.map((s) => s.label))).toEqual(new Set(Object.keys(HOUSEHOLD_COPY)));
  });

  /**
   * Slice-8 critics F-1/F-2: the SAME ban, applied to every in-app partner-due
   * string. "you'll pay" / "yourself" / "your account" on a partner's card is a
   * false money claim that invites a double payment, on any surface.
   */
  it('every in-app partner-owned string passes the partner-due ban', () => {
    const partnerStrings = [
      HOUSEHOLD_COPY.reminderPartnerAutopayCovered('Sam'),
      HOUSEHOLD_COPY.reminderPartnerPartialAutopay('Sam', cents(40_000), cents(20_000)),
      HOUSEHOLD_COPY.reminderPartnerManual('Sam'),
      HOUSEHOLD_COPY.cardsPartnerToPayLabel(),
      HOUSEHOLD_COPY.cardsPartnerDueNote('Sam'),
      HOUSEHOLD_COPY.cardsPartnerAutopayCovered('Sam'),
      HOUSEHOLD_COPY.cardsPartnerPartialAutopay('Sam', cents(40_000), cents(20_000)),
      HOUSEHOLD_COPY.cardsDueFirstPartner({
        cardName: 'Sapphire',
        ownerLabel: 'Sam',
        amountCents: cents(43_400),
        dateLong: 'June 15, 2026',
        when: 'in 5 days',
      }),
    ];
    for (const text of partnerStrings) {
      for (const banned of PARTNER_DUE_BANNED) {
        expect(text, `"${text}" must not match ${banned}`).not.toMatch(banned);
      }
    }
    // Owner-attributed in every string that names an amount or account.
    for (const text of partnerStrings.filter((t) => t.includes('$') || /account/i.test(t))) {
      expect(text).toContain("Sam's");
    }
  });

  it('digestPartnerDue never bills the reader for a partner\'s card, in ANY autopay shape', () => {
    const base = {
      accountName: 'Sapphire',
      ownerLabel: 'Sam',
      cashRequiredCents: cents(60_000),
      dueDateLong: 'June 15, 2026',
      when: 'in 5 days',
      isEstimated: false,
    };
    const shapes = [
      { ...base, userActionCents: cents(60_000), autopayCents: cents(0), autopayCovered: false },
      { ...base, userActionCents: cents(0), autopayCents: cents(60_000), autopayCovered: true },
      { ...base, userActionCents: cents(20_000), autopayCents: cents(40_000), autopayCovered: false },
    ];
    for (const shape of shapes) {
      const text = HOUSEHOLD_COPY.digestPartnerDue(shape);
      for (const banned of PARTNER_DUE_BANNED) {
        expect(text, `"${text}" must not match ${banned}`).not.toMatch(banned);
      }
      expect(text).toContain("Sam's"); // owner-attributed in every shape
    }
  });
});
