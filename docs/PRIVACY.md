# Privacy & data handling

GDPR/CCPA-minded handling for Pulse Finance. Demo mode stores only the seeded
fictional dataset; everything below applies fully once Plaid is connected.

## What is stored

- Account metadata: institution name, account name, type, **mask (last 4 only)**.
  Full account numbers are never requested, stored, or displayed.
- Transactions, statements, balances, scheduled transactions — the data the
  product's engines need.
- Plaid **access tokens, AES-256-GCM encrypted at rest** (`DATA_ENCRYPTION_KEY`,
  32 bytes). Tokens are never logged and never sent to the client. Raw bank
  credentials never touch this system (they go to Plaid Link directly).
- Audit log: login, account link/unlink, exports, deletions, rule bulk-applies.

## What is NOT stored

Bank usernames/passwords, full card/account numbers, SSNs, Plaid public tokens
(exchanged immediately and discarded).

## Export (data portability)

Settings → Export: transactions (CSV), net worth (CSV/PDF) via
`/api/export` — authenticated, rate-limited, audit-logged.

## Deletion path

1. User requests deletion (Settings → "Delete my data"; UI button ships with
   the first real-account release — demo data is re-creatable by reseeding).
2. For each linked Plaid item: `POST /item/remove` revokes the token at Plaid
   (`PlaidProvider.removeItem`).
3. `DELETE FROM User WHERE id = ?` — the schema cascades (`onDelete: Cascade`)
   to accounts, transactions, statements, payments, scheduled transactions,
   balance snapshots, rules, corrections, recurring series, goals, budgets.
4. A final audit entry records the deletion event (retained without user data).

## Security measures

- All app routes behind session middleware; every server action re-verifies
  the session and scopes queries by `userId` (`src/server/authz.ts`).
- CSP (no third-party scripts), X-Frame-Options DENY, nosniff, strict referrer.
- Rate limiting on auth-sensitive and export endpoints.
- Secrets only via environment variables; `.env.example` documents them all.
