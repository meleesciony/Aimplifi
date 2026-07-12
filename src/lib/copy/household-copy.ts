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
 */

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
    `Read-only transactions from accounts your partner chose to share. Categories and amounts are theirs; your own register above is unchanged.`,

  sharedTxnTruncated: (count: number) => `Showing the most recent ${count}.`,

  // ── src/components/dashboard/household-scope-toggle.tsx — cash-needed scope
  //    toggle, shared across /dashboard, /cards, /calendar (TASKS 4.2 slice 5) ─
  scopeAssumptions: () =>
    `Household scope: includes your accounts and accounts your partner has shared. Anything not shared isn't counted.`,
} as const;
