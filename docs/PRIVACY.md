# Privacy & data handling

GDPR/CCPA-minded handling for Pulse Finance. Demo mode stores only the seeded
fictional dataset; everything below applies fully once Plaid is connected.

## What is stored

- Account metadata: institution name, account name, type, **mask (last 4 only)**.
  Full account numbers are never requested, stored, or displayed.
- Transactions, statements, balances, scheduled transactions — the data the
  product's engines need.
- Value receipts (`ValueReceipt`, #206): an append-only per-user tally of what the
  app proactively surfaced — a delivered payment reminder, a delivered cash-flow
  warning, a flagged subscription price increase — each with an amount copied from
  the moment of the catch, an account/merchant label, and a business date. Feeds
  the /coach "What Aimplifi caught" card and the weekly-digest tally line only.
- Unknown questions (`UnknownQuestion`, #208): PII-scrubbed Ask phrasings the
  deterministic parser could not route (including ones the optional LLM later
  rescued) — emails/amounts/digits stripped before write. Feeds future vocabulary
  mining only; never used to answer or to compute money.
- Engagement events (`EngagementEvent`, #209): first-party records of which
  dashboard cards you view, dismiss, expand, or act on (closed-set card ids only —
  no free text, no amounts, no third-party analytics). Stored so future adaptive
  layout and notification cadence can learn from your attention; cascades on
  account deletion.
- Weekly self-audit snapshots (`SelfAuditSnapshot`, #211): per-user weekly rates
  for review queue share, Ask unrecognized-stay rate, and alert attention (counts
  + basis points only — no money). Surfaced on Settings → AI trust; cascades on
  deletion.
- Delivered-notification dedup keys (`NotificationSent`): the stable key + timestamp
  of each push/digest actually delivered, kept so the same alert isn't re-sent
  (pruned after 120 days).
- Household membership (`Household`/`HouseholdMember`/`HouseholdInvite`, 4.2 slice 1):
  the household's display name, who belongs to it (role + joined date), and pending
  invites — each invite stores the invitee's normalized sign-in email, the inviting
  user's id, and a one-way salted hash of the one-time invite code (**the plaintext
  code exists nowhere at rest** and is never emailed; it is shown once to the inviter
  for out-of-band handoff). Members of the same household see each other's name and
  sign-in email in Settings. Membership rows cascade on account deletion; leaving or
  being removed resets every account-sharing consent the departing member had granted.
  The shared demo account is guarded out of household membership entirely.
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
   Plaid items, category predictions, push subscriptions, notification dedup keys,
   value receipts, **and audit log rows**: deletion removes everything personal, audit
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
