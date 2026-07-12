/**
 * Every user-facing Household string lives here (TASKS 4.2 slice 5 — cross-app
 * copy audit), so a guardrail test can scan them exhaustively for the same
 * rules as COACH_COPY (`src/lib/engine/fi/coach-copy.ts`):
 *  - educational, never advisory
 *  - zero shame language
 *  - every disclosure states what is and isn't shared, inline
 *
 * Extracted verbatim from the slice 1–4 UI (src/components/settings/household-card.tsx,
 * src/components/finance/household-sharing-card.tsx, src/components/finance/shared-transaction-list.tsx,
 * src/components/dashboard/household-scope-toggle.tsx, src/app/(app)/settings/page.tsx) — no
 * wording changed, only relocated so tests/unit/household-copy.test.ts can scan it.
 *
 * Slice 7 adds the joint-digest strings here (rather than to COACH_COPY) so the
 * household guardrail scan covers them; the scan is exhaustive over this object's
 * keys, so a new string cannot enter the product unscanned.
 */
import { formatCents, type Cents } from '@/lib/money';

export const HOUSEHOLD_COPY = {
  // ── src/app/(app)/settings/page.tsx — Household card intro ─────────────────
  teamSportTagline: () => `Money is a team sport — when you choose it to be`,

  disclosure: () =>
    `A household connects your account with a partner's. Membership alone shares nothing: no partner can see any account, balance, or transaction of yours unless you explicitly share it, and you can leave at any time — leaving ends anything you've shared.`,

  // ── src/components/settings/household-card.tsx — invite lifecycle ──────────
  inviteCodeHint: () => `Enter the invite code they gave you directly (it's never emailed).`,

  inviteCodeIssued: (email: string) =>
    `Share this code with them directly (in person or a message) — it is shown only once and never emailed. They enter it here in Settings after signing in with ${email}. It expires in 14 days.`,

  inviteFormHint: () =>
    `Use the email they sign in with. You'll get a one-time code to hand them directly — nothing is emailed on your behalf.`,

  leaveConfirm: (householdName: string) =>
    `Leave ${householdName}? Any accounts you've shared stop being shared.`,

  // ── src/components/finance/household-sharing-card.tsx — /accounts sharing ──
  sharedWithYouDisclosure: () =>
    `Read-only balances your partner chose to share. Anything they haven't shared isn't shown — this is not their full picture.`,

  noAccountsToShare: () => `Connect or add an account first — then you can share it here.`,

  shareYourAccountsDisclosure: () =>
    `Sharing shows an account's name, type, last 4 digits, balance, and transactions (read-only, labeled with your name on their register) to everyone in your household, updated as it syncs. You can stop sharing anytime, and leaving the household unshares everything.`,

  // ── src/components/finance/shared-transaction-list.tsx — /transactions ─────
  sharedTxnDisclosure: () =>
    `Transactions from accounts your partner chose to share. You can recategorize one at a time — no rule is created and it never changes how your partner's future transactions file; amounts and everything else are theirs, unchanged.`,

  sharedTxnTruncated: (count: number) => `Showing the most recent ${count}.`,

  sharedTxnRecatHint: () =>
    `Recategorizes it for both of you — no rule is created, and it never changes how your partner's future transactions file.`,

  // ── src/components/dashboard/household-scope-toggle.tsx — cash-needed scope
  //    toggle, shared across /dashboard, /cards, /calendar (TASKS 4.2 slice 5) ─
  //    Slice-8 critic F-3: the autopay sentence is load-bearing — autopay on a
  //    partner's card drafts from THEIR account, so the household total is not
  //    all money the reader must position themselves.
  scopeAssumptions: () =>
    `Household scope: includes your accounts and accounts your partner has shared. Anything not shared isn't counted. Autopay on a partner's shared card drafts from the partner's account, not from one of yours.`,

  /** Headline attribution at household scope (slice-8 critic F-3): the joint
   *  total is needed ACROSS the household — naming the viewer's own funding
   *  account would claim a partner's autopay draft must sit there, which is
   *  false (it drafts from the partner's account). */
  headlineAcrossHousehold: (householdName: string) => `across ${householdName}`,

  // ── src/components/finance/payment-reminders-card.tsx — partner-owned rows
  //    at household scope (slice-8 critic F-1). Same stance as digestPartnerDue:
  //    owner-attributed, never billing the reader for a partner's account. ────
  reminderPartnerAutopayCovered: (owner: string) =>
    `autopay handles it from ${owner}'s account`,

  reminderPartnerPartialAutopay: (owner: string, autopayCents: Cents, remainingCents: Cents) =>
    `autopay covers ${formatCents(autopayCents)}; the remaining ${formatCents(remainingCents)} sits on ${owner}'s account`,

  reminderPartnerManual: (owner: string) =>
    `on ${owner}'s account — shared with you read-only; Aimplifi doesn't decide who pays`,

  // ── src/components/finance/cards-breakdown.tsx — partner-owned cards at
  //    household scope (slice-8 critic F-2) ─────────────────────────────────
  cardsPartnerToPayLabel: () => `To pay`,

  cardsPartnerDueNote: (owner: string) =>
    `On ${owner}'s account, shared with you read-only. Aimplifi doesn't decide who pays.`,

  cardsPartnerAutopayCovered: (owner: string) =>
    `Autopay handles it from ${owner}'s account.`,

  cardsPartnerPartialAutopay: (owner: string, autopayCents: Cents, remainingCents: Cents) =>
    `Autopay covers ${formatCents(autopayCents)}; the remaining ${formatCents(remainingCents)} sits on ${owner}'s account.`,

  cardsDueFirstPartner: (p: {
    cardName: string;
    ownerLabel: string;
    amountCents: Cents;
    dateLong: string;
    when: string;
  }) =>
    `Due first: ${p.cardName} (${p.ownerLabel}'s) — ${formatCents(p.amountCents)} by ${p.dateLong} (${p.when}), on ${p.ownerLabel}'s account.`,

  // ── Household-scope disclosures shared by /dashboard, /cards, /calendar ────
  /** #135 stance at household scope (slice-8 critic F-6): a partner's non-USD
   *  shared account is withheld from the figures but never silently. */
  scopeUnsupportedCurrency: (count: number) =>
    `${count} shared account${count === 1 ? " isn't" : "s aren't"} counted in household figures: Aimplifi handles US dollars today, so ${count === 1 ? 'it is' : 'they are'} left out rather than converted at a rate nobody agreed to.`,

  /** Same-real-account-connected-twice disclosure (slice-8 critic F-5 / T9(b)).
   *  ADVISORY like the #192 warning: the figures are NOT adjusted, because the
   *  match is heuristic and silently dropping a real account would be worse. */
  householdDuplicateTitle: () => `Possible double-count in household figures`,

  householdDuplicatePair: (aName: string, aOwner: string, bName: string, bOwner: string) =>
    `${aName} (${aOwner}) and ${bName} (${bOwner}) look like the same real account connected twice.`,

  householdDuplicateFooter: () =>
    `If they are, the household figures count that money twice. Aimplifi never merges or removes accounts — whoever owns the extra connection can unshare or disconnect it, and the figures correct themselves.`,

  // ── Joint household digest email (TASKS 4.2 slice 7 — DECISIONS #201(2)) ───
  //    Composed by src/lib/engine/digest/build.ts; delivered per recipient by
  //    src/app/api/cron/digest/route.ts.
  digestSubject: () => `Your household's week with Aimplifi`,

  digestPaymentsHeader: () => `Coming up in the next 7 days across your household:`,

  digestSharedHeader: (householdName: string) => `Shared in ${householdName}:`,

  //    "spending account(s)" is precise, not decorative (slice-8 critic F-4):
  //    the movement tally spans shared CHECKING/SAVINGS/CREDIT only — a shared
  //    loan is counted for dues but has no movement to tally, and the copy must
  //    not imply it was.
  digestMovement: (
    transactionCount: number,
    accountCount: number,
    outflowCents: Cents,
    inflowCents: Cents,
  ) =>
    `${transactionCount} transaction${transactionCount === 1 ? '' : 's'} on ${accountCount} shared spending account${accountCount === 1 ? '' : 's'} in the last 7 days — ${formatCents(outflowCents)} out, ${formatCents(inflowCents)} in. Counts only the accounts someone in the household chose to share; anything not shared isn't included.`,

  /**
   * A due on a PARTNER's shared card/loan (slice-7 critic F1). The personal
   * `reminderLine` is second-person by construction ("you'll pay $600 yourself",
   * "keep the funds in your account") — rendering that for a partner's card tells
   * the reader they must personally pay someone else's bill, which is false and
   * invites a double payment. This line is owner-attributed and says only what is
   * true: whose account it sits on, what it needs, and that Aimplifi is not
   * assigning the payment to anyone.
   */
  digestPartnerDue: (p: {
    accountName: string;
    ownerLabel: string;
    cashRequiredCents: Cents;
    userActionCents: Cents;
    autopayCents: Cents;
    autopayCovered: boolean;
    dueDateLong: string;
    when: string;
    isEstimated: boolean;
  }) => {
    let how: string;
    if (p.autopayCovered) {
      how = `${p.ownerLabel} has autopay set on it, so the funds need to be in ${p.ownerLabel}'s account`;
    } else if (p.autopayCents > 0) {
      how = `autopay covers ${formatCents(p.autopayCents)}; the remaining ${formatCents(p.userActionCents)} sits on ${p.ownerLabel}'s account`;
    } else {
      how = `it's on ${p.ownerLabel}'s account, not yours`;
    }
    return `• ${p.accountName} (${p.ownerLabel}'s): ${formatCents(p.cashRequiredCents)} due ${p.dueDateLong} (${p.when})${p.isEstimated ? ' [estimated]' : ''} — ${how}. You see it because the account is shared; Aimplifi doesn't decide who pays.`;
  },

  digestUnsupportedCurrency: (count: number) =>
    `${count} shared account${count === 1 ? " isn't" : "s aren't"} counted above: Aimplifi handles US dollars today, so ${count === 1 ? 'it is' : 'they are'} left out of every figure here rather than converted at a rate nobody agreed to.`,

  digestNoMovement: (accountCount: number) =>
    `No transactions on the ${accountCount} shared spending account${accountCount === 1 ? '' : 's'} in the last 7 days. Accounts nobody shared aren't counted here.`,

  /** Shared accounts exist but none is a spending account (slice-8 critic F-4):
   *  a loan-only household must never be told "nothing is shared" while that
   *  loan's due is listed in the same email. */
  digestNoSpendingShared: (count: number) =>
    `${count === 1 ? "The 1 shared account isn't a spending account" : `None of the ${count} shared accounts are spending accounts`} (checking, savings, or a card), so there's no weekly movement to tally — anything due on ${count === 1 ? 'it' : 'them'} appears with the payments above. Accounts nobody shared aren't counted here.`,

  digestNothingShared: (householdName: string) =>
    `No accounts are shared in ${householdName} yet, so this email counts only your own. You can share an account from Settings at any time, and stop sharing it just as easily.`,

  /** F-5 disclosure in the joint digest — the mailed figures may double-count. */
  digestDuplicateWarning: (pairCount: number) =>
    `${pairCount === 1 ? 'Two of the accounts counted here look' : `${pairCount} pairs of the accounts counted here look`} like the same real account connected twice — if so, the household figures in this email count that money twice. Whoever owns the extra connection can unshare or disconnect it.`,

  digestPrivacyNote: () =>
    `Your Money Review above is yours alone: it's computed from your own accounts, shared or not. Your partner's copy of this email shows theirs, never yours.`,
} as const;
