# Plaid sandbox walkthrough (manual)

**Status: UNVERIFIED in this build** — the build environment has no Plaid
credentials, so `src/lib/providers/plaid.ts` is implemented against the
documented Plaid API and must be validated with this walkthrough before
production use. Demo mode is unaffected.

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

## 3. Transactions sync

- `POST /transactions/sync` with the stored cursor; map results into
  `Transaction` rows. **Sign convention flip:** Plaid amounts are
  outflow-POSITIVE; Pulse stores outflow-NEGATIVE — negate on ingest.
- Re-run until `has_more` is false; persist `next_cursor` per item.
- Webhook `SYNC_UPDATES_AVAILABLE` → call the sync route; also covered by the
  cron sweep (`/api/cron/sync`, `Authorization: Bearer $CRON_SECRET`).

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
