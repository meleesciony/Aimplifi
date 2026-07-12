/**
 * Weekly digest email (Competitive-Gap plan Gap 2 §3) — the cheapest retention win:
 * bring the user back without a new surface. PURE, no I/O. It COMPOSES two
 * already-computed, already-tested pieces and renders them as plain text:
 *
 *   1. The Monthly Money Review (`generateMoneyReview` → the same object /coach shows):
 *      what improved, what crept, and the single next action. Copied verbatim — the
 *      digest never recomputes a number, so it can't disagree with /coach.
 *   2. The upcoming week's payment dues (`selectPaymentReminders` within 7 days),
 *      rendered by the SHARED `reminderLine` so a due reads identically to the
 *      reminder email and the in-app card.
 *
 * All wrapper copy lives in COACH_COPY (guardrail-scanned by coach-copy.test.ts).
 * Returns null only when there is genuinely nothing to say (no review AND no dues) —
 * a brand-new user with no history and nothing due gets no digest.
 */
import { type ISODate, formatISODate } from '@/lib/dates';
import { HOUSEHOLD_COPY } from '@/lib/copy/household-copy';
import { COACH_COPY, type MoneyReview } from '@/lib/engine/fi/coach-copy';
import type { SharedMovementSummary } from '@/lib/engine/household/digest';
import { type PaymentReminder, reminderLine, reminderWhen } from '@/lib/engine/reminders/select';
import { receiptLines, type ValueReceiptsSummary } from '@/lib/engine/receipts/receipts';

export interface WeeklyDigest {
  subject: string;
  text: string;
}

/**
 * Household context for the JOINT digest (TASKS 4.2 slice 7, DECISIONS #201(2)):
 * present only for a member with at least one live partner. Its presence flips the
 * subject, the dues header (the `reminders` passed in are then household-scope) and
 * appends the shared-movement + assumptions block.
 */
export interface HouseholdDigestContext {
  name: string;
  movement: SharedMovementSummary;
  /**
   * accountId → owning partner's display name, for PARTNER-owned shared accounts
   * ONLY (never the viewer's own). A due on one of these must not render through
   * the second-person `reminderLine` (slice-7 critic F1) — the viewer does not pay
   * their partner's card, and saying they do invites a double payment.
   */
  partnerAccountLabels: Record<string, string>;
  /** Shared accounts withheld from every figure by the #135 currency guard — disclosed, never silent. */
  withheldAccountCount: number;
  /**
   * ALL supported shared accounts, of ANY type (slice-8 critic F-4) — distinct
   * from `movement.accountCount`, which spans shared SPENDING accounts only.
   * Drives the "is anything shared at all?" branch: a household sharing only a
   * loan must never be told "no accounts are shared" while that loan's due is
   * listed in the same email.
   */
  sharedAccountCount: number;
  /** Suspected same-real-account-connected-twice pairs across the set the
   *  mailed figures are computed over (slice-8 critic F-5) — disclosed. */
  duplicatePairCount: number;
}

export function buildWeeklyDigest(input: {
  review: MoneyReview | null;
  reminders: readonly PaymentReminder[];
  today: ISODate;
  /**
   * Cumulative value-receipts tally (TASKS 1.3), rendered via the SAME receiptLines
   * the /coach card uses. Optional and never a send trigger: a digest with no review
   * and nothing due stays null — a running tally alone isn't news.
   */
  receipts?: ValueReceiptsSummary | null;
  /**
   * Household scope (slice 7). Like `receipts`, NEVER a send trigger on its own:
   * a member with no review and nothing due gets no email just because a shared
   * account moved. Absent/null ⇒ the personal digest, byte-identical to pre-slice-7.
   */
  household?: HouseholdDigestContext | null;
}): WeeklyDigest | null {
  const { review, reminders, today, receipts, household } = input;
  if (!review && reminders.length === 0) return null;

  const parts: string[] = [COACH_COPY.digestIntro(formatISODate(today, 'long')), ''];

  if (review) {
    parts.push(review.improvement, review.creep, '', review.nextAction, '');
  }

  if (receipts && receipts.total > 0) {
    parts.push(COACH_COPY.digestCaughtHeader(), ...receiptLines(receipts).map((l) => `• ${l}`), '');
  }

  parts.push(household ? HOUSEHOLD_COPY.digestPaymentsHeader() : COACH_COPY.digestPaymentsHeader());
  if (reminders.length === 0) {
    parts.push(COACH_COPY.digestNothingDue());
  } else {
    for (const r of reminders) {
      // A partner's shared card NEVER renders through the second-person
      // reminderLine (critic F1): the viewer is not the one paying it.
      const ownerLabel = household?.partnerAccountLabels[r.accountId];
      parts.push(
        ownerLabel
          ? HOUSEHOLD_COPY.digestPartnerDue({
              accountName: r.accountName,
              ownerLabel,
              cashRequiredCents: r.cashRequiredCents,
              userActionCents: r.userActionCents,
              autopayCents: r.autopayCents,
              autopayCovered: r.autopayCovered,
              dueDateLong: formatISODate(r.dueDate, 'long'),
              when: reminderWhen(r.daysUntil),
              isEstimated: r.isEstimated,
            })
          : reminderLine(r),
      );
    }
  }

  if (household) {
    const { accountCount, transactionCount, outflowCents, inflowCents } = household.movement;
    const { sharedAccountCount } = household;
    parts.push('', HOUSEHOLD_COPY.digestSharedHeader(household.name));
    // The "anything shared?" branch keys on sharedAccountCount — ALL supported
    // shared accounts — never on the spending-only movement.accountCount
    // (slice-8 critic F-4: a loan-only household got "no accounts are shared"
    // directly beside its shared loan's due line).
    if (sharedAccountCount === 0 && household.withheldAccountCount === 0) {
      // Partners, but nobody has shared an account: household scope is exactly
      // 'mine', and the copy says so rather than rendering "0 shared accounts".
      parts.push(HOUSEHOLD_COPY.digestNothingShared(household.name));
    } else if (sharedAccountCount === 0) {
      // Everything shared is in an unsupported currency — say so (critic F3):
      // "nothing is shared yet" would be a lie, and a silent withhold breaks #135.
      parts.push(HOUSEHOLD_COPY.digestUnsupportedCurrency(household.withheldAccountCount));
    } else if (accountCount === 0) {
      // Shared accounts exist but none is a spending account (a loan, say):
      // there is no movement to tally, and the copy says WHY, truthfully.
      parts.push(HOUSEHOLD_COPY.digestNoSpendingShared(sharedAccountCount));
    } else if (transactionCount === 0) {
      parts.push(HOUSEHOLD_COPY.digestNoMovement(accountCount));
    } else {
      parts.push(
        HOUSEHOLD_COPY.digestMovement(transactionCount, accountCount, outflowCents, inflowCents),
      );
    }
    if (sharedAccountCount > 0 && household.withheldAccountCount > 0) {
      parts.push(HOUSEHOLD_COPY.digestUnsupportedCurrency(household.withheldAccountCount));
    }
    if (household.duplicatePairCount > 0) {
      // F-5: the figures above may double-count a twice-connected account —
      // disclosed in the same email that mails them.
      parts.push(HOUSEHOLD_COPY.digestDuplicateWarning(household.duplicatePairCount));
    }
    // Assumptions inline, always (CLAUDE.md coaching guardrail): the joint number
    // above must never imply completeness — a partner's private card is invisible
    // by design (§4.4), and the reader is told so in the same breath.
    parts.push('', HOUSEHOLD_COPY.scopeAssumptions());
    if (review) parts.push(HOUSEHOLD_COPY.digestPrivacyNote());
  }

  parts.push('', COACH_COPY.digestOutro());

  return {
    subject: household ? HOUSEHOLD_COPY.digestSubject() : COACH_COPY.digestSubject(),
    text: parts.join('\n'),
  };
}
