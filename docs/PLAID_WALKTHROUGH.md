# Plaid sandbox walkthrough (manual)

**Status: IMPLEMENTED, UNVERIFIED against a live sandbox.** The full path is now
real code, not a stub: link-token creation, public-token exchange (AES-256-GCM
token storage in the `PlaidItem` table), `/accounts/get`, `/transactions/sync`
(cursor loop, categorized through the standard pipeline), `/liabilities/get` →
`Statement`, the webhook receiver, and `/item/remove`.

What is **tested** (pure, no network): every Plaid→Pulse mapping in
`src/lib/providers/plaid-map.ts` — sign flip, account-type mapping,
liability→statement, per-row categorization — see `tests/unit/plaid-map.test.ts`
(18 cases). What is **UNVERIFIED**: all network orchestration in `plaid.ts` has
never run against a live Plaid sandbox (no credentials in the build env). What
is **PENDING**: (a) recurring re-detection + `ScheduledTransaction` refresh after
ingest — per-row normalize→rules→categorize→transfer is wired, the cross-account
recurring/scheduled tail of DECISIONS #22 is not yet called from `syncTransactions`;
(b) Plaid-Verification (JWT) signature checking on the webhook. Demo mode is
entirely unaffected. Run §5 to validate before trusting this with real money.

## 1. Credentials

1. Create a free account at <https://dashboard.plaid.com> → get the sandbox
   `client_id` and `secret`.
2. `.env.local`:
   ```
   DATA_PROVIDER=plaid
   PLAID_CLIENT_ID=...
   PLAID_SECRET=...
   PLAID_ENV=sandbox
   DATA_ENCRYPTION_KEY=<openssl rand -base64 32>
   ```

## 2. Link flow (sandbox)

1. Server: `PlaidProvider.createLinkToken(userId)` → render Plaid Link
   (client SDK) with the token.
2. In sandbox, use credentials `user_good` / `pass_good`; institution
   "First Platypus Bank".
3. Link yields a `public_token` → `PlaidProvider.exchangePublicToken` stores
   the access token AES-256-GCM-encrypted and audit-logs the link.

## 3. Transactions sync (implemented in `PlaidProvider.syncTransactions`)

- `POST /transactions/sync` with the stored per-item cursor; added/modified rows
  map into `Transaction` via `prepareIngestedTransaction` (normalize → user
  rules → categorize → set category/confidence/needsReview/isTransfer), removed
  rows are deleted, the cursor is persisted on the `PlaidItem`.
- **Sign convention flip** (tested): Plaid amounts are outflow-POSITIVE; Pulse
  stores outflow-NEGATIVE — `plaidAmountToCents` negates on ingest.
- Re-runs until `has_more` is false. After ingest, `detectTransfers` re-derives
  `isTransfer` across the user's full set (descriptor + pair matching).
- Triggered by the webhook (`/api/plaid/webhook`, TRANSACTIONS) and by the cron
  sweep (`/api/cron/sync`, `Authorization: Bearer $CRON_SECRET`).
- **PENDING:** recurring re-detection + scheduled refresh (DECISIONS #22 tail).

## 4. Liabilities → statements

- `POST /liabilities/get` → for each credit card:
  `last_statement_balance` → `statementBalanceCents`,
  `minimum_payment_amount` → `minimumPaymentCents`,
  `next_payment_due_date` → `dueDate`,
  `last_statement_issue_date` → `cycleEnd`.
- Autopay flags from `is_overdue`/issuer data are NOT provided by Plaid —
  autopay config remains a user setting in Pulse.

## 5. Validation checklist (run before calling this integration done)

- [ ] Link → exchange → token row encrypted (inspect DB: no plaintext)
- [ ] Sync inserts transactions with correct signs and dates
- [ ] Liabilities populate statements; cash-needed headline computes
- [ ] Webhook triggers an incremental sync
- [ ] `/item/remove` + cascade delete leaves zero user rows
