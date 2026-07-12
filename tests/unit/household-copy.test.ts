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
]);

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
});
