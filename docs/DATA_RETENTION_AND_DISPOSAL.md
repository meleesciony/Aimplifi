# Aimplifi — Data Retention and Disposal Policy

**Effective date: 2026-06-26 | Version 1.2**

> Source of truth for the Plaid compliance deliverable. The uploaded `.docx`
> (Downloads/Aimplifi-Data-Retention-Policy.docx) is generated from this content.
> Keep in sync with `src/lib/legal/privacy-policy.ts` and `docs/PRIVACY.md`.
> Every statement here reflects data-handling behavior implemented in the codebase
> as of the effective date above (cited modules in parentheses).

## 1. Overview

Aimplifi is a personal, non-commercial personal-finance application operated by an
individual developer for a small, invited group of household members and friends. It
helps users see exactly how much money they need, and by when, to pay every credit card
in full. This policy describes what data is collected, how long it is retained, how it is
secured, and how it is permanently deleted on request or account closure.

Aimplifi has no paying customers. On the deployed app, account creation is invite-only:
both email/password signup and Google sign-in are gated by the same email allowlist (the
household owners are always permitted), so no account can be created for an address that
has not been invited (`src/lib/auth/allowlist.ts`, `src/lib/auth/google-provision.ts`). In
demo mode the app runs entirely on a seeded, fictional dataset, so no real financial data
is involved until a user creates an account and links a bank.

## 2. Data Collected and Retention Periods

| Data category | Retention / notes |
| --- | --- |
| Account metadata | Retained while the account is active. Last-4 digit mask only — full account numbers are never requested, stored, or displayed (`prisma/schema.prisma` `Account.mask`). |
| Transactions, balances & statements | Retained while the account is active; the app imposes no separate expiry. Deleted completely on account deletion. |
| Receipts & documents attached to a transaction | Retained while the transaction exists. Stored in the application database (`TransactionAttachment` + `AttachmentBlob`), **not** in external object storage, precisely so that the single cascading delete described in §3 removes the file itself — an object store would require a separate compensating deletion on every path, and one missed path would leave a receipt image outside this policy indefinitely. Removed when the reader deletes the file, the transaction, the account, or the whole record — and also when the *bank* withdraws the transaction it is attached to (a pending charge reported as removed, or a stale pending row aged out), since the file cannot outlive the charge it documents. A pending charge that merely POSTS under a new id keeps its attachments: the sync re-points them onto the settled row. Capped at 5 MB per file and 5 files per transaction. |
| Derived data (recurring & scheduled items, categorization rules, corrections, goals, budgets, balance snapshots, holdings) | Retained while the account is active; cascade-deleted with the user record on account deletion. |
| Provider access tokens (Plaid / SimpleFIN) | Retained while a connection is active, AES-256-GCM encrypted at rest (`src/lib/crypto.ts`). Revoked at the provider (Plaid `POST /item/remove`) during account deletion. |
| Account settings (email, salted scrypt password hash, planning assumptions) | Retained while the account is active; deleted on account deletion (`src/lib/auth/password.ts`). |
| Audit log of sensitive actions | Retained while the account is active; cascade-deleted with the user record — nothing is retained after deletion. |
| Session tokens | Stateless JWTs carried in an HTTP-only cookie; they expire on their own schedule and are cleared from the browser on sign-out. |
| Bank credentials | Never stored. Entered directly into Plaid Link / SimpleFIN and never transmitted to Aimplifi servers. |

## 3. Data Deletion Process

Users may permanently delete all of their data at any time via Settings → "Delete my
data" (`src/server/account-actions.ts`). The process is:

1. The user must type an exact confirmation phrase before the deletion control becomes
   active (a deliberate-action safety gate). The same phrase is re-validated on the server.
2. A live summary of exactly what will be removed is shown before confirmation.
3. For each linked Plaid item, `POST /item/remove` revokes the access token at Plaid. A
   Plaid-side failure never blocks the user's right to delete.
4. A single cascading delete of the user record removes every associated row: accounts,
   transactions, statements, card payments, balance snapshots, scheduled transactions,
   categorization rules, corrections, recurring series, goals, budgets, holdings, linked
   Plaid/SimpleFIN connections, attached receipts and the files themselves, and audit-log
   rows (`onDelete: Cascade` throughout `prisma/schema.prisma`).
5. The action is session-verified and scoped to the requesting user's own records, and it
   is idempotent — if the record is already gone it completes silently and signs the user
   out.

There is no soft-delete or archive path; nothing about the user is retained after deletion.

## 4. Data That Is Never Collected

- Bank usernames or passwords (entered directly into Plaid Link / SimpleFIN, never
  transmitted to Aimplifi).
- Full account or card numbers (only the last-4 mask is ever stored).
- Social Security numbers or other government identifiers.
- Plaid public tokens (exchanged for an encrypted access token immediately and discarded).

## 5. Security Measures for Retained Data

- **Encryption in transit:** all traffic is served over HTTPS/TLS, terminated by the
  hosting provider (Vercel).
- **Encryption at rest:** all application data is stored in a managed PostgreSQL database
  (Neon) that encrypts data at rest at the storage layer; provider access tokens (and the
  SimpleFIN access URL, which embeds credentials) are additionally encrypted at the
  application layer with AES-256-GCM using a 32-byte key supplied via an environment
  variable — never written to code or logs (`src/lib/crypto.ts`).
- **Access control:** all pages and user-facing data APIs require an authenticated user
  session (enforced by middleware), and every server action independently re-verifies the
  session and scopes each database query by user id, so no user can read or modify another
  user's data (`src/server/authz.ts`). Two machine-to-machine endpoints that also process
  stored data are authenticated by secret rather than a user session: the scheduled cron
  jobs by a constant-time `CRON_SECRET` bearer check (which fails closed if the secret is
  unset), and the Plaid webhook by Plaid's ES256 signature.
- **Hardened HTTP headers:** a strict Content-Security-Policy that loads no third-party
  analytics or advertising scripts, plus `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, and a strict referrer policy (`next.config.ts`).
- **Rate limiting** on the sign-in (per-device and per-account) and data-export endpoints
  to blunt brute-force and abuse.
- **Secrets** (encryption key, provider and AI credentials) live only in environment
  variables and are never logged or exposed to the client.

## 6. Third-Party Data Sharing

Aimplifi does not sell, license, or share user data with any third party for commercial
purposes, and it serves no ads. The only external data flows are:

- **Account aggregation — Plaid (and, optionally, SimpleFIN):** balances, transactions,
  and liabilities are retrieved from the provider after the user authorizes the connection.
  The provider's own privacy policy governs its handling of that data.
- **Optional AI assistance (off unless an AI key is configured):** two narrow, key-gated
  flows. (a) To suggest a category for an unrecognized transaction, only that transaction's
  raw descriptor and amount are sent. (b) To route an unrecognized typed question to a
  feature, only the question text is sent. Neither flow includes names, email, account
  numbers, masks, or balances. The provider is xAI or Anthropic depending on which key is
  set; with no key configured, nothing is sent and a deterministic fallback is used instead.
- **Hosting — Vercel:** the application runs on Vercel's infrastructure; Vercel's privacy
  policy governs server-side request logging.
- **Database — Neon:** all application data is stored in a managed PostgreSQL database
  operated by Neon, which encrypts data at rest. Neon's privacy policy governs its handling
  of stored data.

## 7. Policy Review

This policy is reviewed and updated whenever the application materially changes its data
collection, storage, or deletion practices, and at least annually. The version and
effective date are updated accordingly. As a personal, non-commercial project operated by a
single developer, reviews are tied to application releases.

## Contact

Questions about this policy, or requests related to personal data, may be directed to the
operator at michael.lee.p@gmail.com (also provided to Plaid during the production-access
application).
