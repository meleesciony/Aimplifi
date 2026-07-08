# Privacy & data handling

GDPR/CCPA-minded handling for Pulse Finance. Demo mode stores only the seeded
fictional dataset; everything below applies fully once Plaid is connected.

## What is stored

- Account metadata: institution name, account name, type, **mask (last 4 only)**.
  Full account numbers are never requested, stored, or displayed.
- Transactions, statements, balances, scheduled transactions — the data the
  product's engines need.
- Plaid **access tokens, AES-256-GCM encrypted at rest** (`DATA_ENCRYPTION_KEY`,
  32 bytes) — applies to the dormant Plaid path; demo mode stores no tokens.
  Tokens are never logged and never sent to the client. Raw bank credentials
  never touch this system (they go to Plaid Link directly).
- Audit log — what is logged TODAY: sign-in (best-effort — never blocks login), data exports (CSV/PDF), goal
  create/delete, budget set/clear, money-dials update, rule creation and
  batch-apply, cron sync runs, (dormant Plaid path) item link/remove, and
  account deletion (`account.delete`, written immediately before the cascade that
  also removes it — per §Deletion, nothing about the user is retained).

## What is NOT stored

Bank usernames/passwords, full card/account numbers, SSNs, Plaid public tokens
(exchanged immediately and discarded).

## Export (data portability)

Settings → Export: transactions (CSV), net worth (CSV/PDF) via
`/api/export` — authenticated, rate-limited, audit-logged.

## Deletion path

1. User requests deletion (Settings → "Delete my data") behind a **typed
   confirmation gate** — the destructive button is inert until the user types the
   exact phrase, the deliberate-action safety. A live summary shows what will be
   removed. In demo mode the sample dataset is re-creatable by reseeding
   (`npx prisma db seed`).
2. For each linked Plaid item: `POST /item/remove` revokes the token at Plaid
   (`PlaidProvider.removeItem`), best-effort — a Plaid failure never blocks the
   user's right to delete.
3. A **PII-free deletion record** is written first (`DeletionRecord`): a one-way
   salted hash of the user id (`hashUserRef` = sha256(salt:id)) plus a timestamp,
   in a table with NO relation to `User` so the cascade never removes it. It
   retains nothing recoverable — not the email (even for a Google user, whose id
   embeds one), not the name — but proves a deletion occurred. An operator holding
   a specific id can confirm its deletion; nobody can enumerate ids from the sink.
4. `DELETE FROM User WHERE id = ?` — the schema cascades (`onDelete: Cascade`)
   to accounts, transactions, statements, payments, scheduled transactions,
   balance snapshots, rules, corrections, recurring series, goals, budgets,
   Plaid items, **and audit log rows**: deletion removes everything personal, audit
   trail included (nothing recoverable about the user is retained — only the hashed
   deletion record above survives). The action is idempotent — if the row is already
   gone it simply signs out (no error).

**Multi-device session invalidation (Gap 6 §3 — now implemented):** each user
carries a `sessionEpoch` stamped into the JWT at sign-in and re-checked on every
Node-side session resolution (`isSessionEpochCurrent`, called from the Node session
callback that every server action + page reaches via `requireUserId`). A deleted
account (row gone) fails the check on **every** device, not just the current
browser; and Settings → "Sign out of all devices" (`revokeOtherSessions`) bumps the
epoch to invalidate every previously issued token — including the current one, so
you sign back in. Enforcement is at the Node data-access boundary; the edge
middleware stays Prisma-free (a stale token may pass the coarse route gate but
cannot read any user data, since all data access re-resolves the session through
the enforced callback).

**Known limitations (real-auth release):** there is no password-change flow yet, so
the deliberate revoke control is the only user-initiated epoch bump today. The
epoch check adds one indexed primary-key lookup per authenticated request
(negligible beside the per-render snapshot load). DB-strategy sessions remain a
possible future move if instant per-request revocation without a token round-trip
is ever needed.

## Security measures

- All app routes behind session middleware; every server action re-verifies
  the session and scopes queries by `userId` (`src/server/authz.ts`).
- CSP (no third-party scripts loaded — only the Plaid Link SDK origin is
  allowlisted), HSTS (production), X-Frame-Options DENY, nosniff, strict referrer.
- Rate limiting on the export endpoint and on authentication, backed by a durable
  database-stored counter (the `RateLimit` table) that survives restarts and is
  consistent across instances — not in-memory. Sign-in pairs a per-IP request cap
  with a per-account failure throttle, so a correct password is never locked out.
- Secrets only via environment variables; `.env.example` documents them all.
