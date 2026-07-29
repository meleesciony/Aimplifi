# Plaid sandbox walkthrough (manual)

**Status: IMPLEMENTED + HARDENED + LIVE-PATH VERIFIED (Plaid sandbox, 2026-07-09).**
`npm run plaid:validate` ran green against the live sandbox (Wave 0.4):
`✅ VALIDATION PASSED — 12 accounts (2 credit), 50 transactions with correct signs,
1 statement from /liabilities/get`; encrypted `PlaidItem` token stored (len 110),
then item + temp user cleaned up. This flips the network paths §5 exercises —
`/sandbox/public_token/create`, exchange, `/accounts`, `/transactions/sync`,
`/liabilities/get` — from UNVERIFIED to verified. Still UNVERIFIED: the interactive
browser Link UI and the live webhook round-trip (both need a human/hosted step, not
`plaid:validate`). The full
path is real code, not a stub: link-token creation, public-token exchange
(AES-256-GCM token storage in the `PlaidItem` table), `/accounts/get`,
`/transactions/sync` (cursor loop, categorized through the standard pipeline,
recurring/scheduled re-detection on the tail), `/liabilities/get` → `Statement`,
the webhook receiver **with ES256 `Plaid-Verification` JWT verification**, and
`/item/remove`.

What is **tested** (pure, no network): every Plaid→Aimplifi mapping in
`src/lib/providers/plaid-map.ts` — sign flip, signed-balance conversion,
account-type mapping, liability→statement, per-row categorization, and the
`personal_finance_category` passthrough (DECISIONS #155 — Plaid's own per-txn
category is mapped to our taxonomy and used ONLY to rescue an otherwise-review row;
never overrides a rule/transfer/confident-merchant/aggregate, is sign-guarded, and
never infers a `transfer`) (`tests/unit/plaid-map.test.ts`,
`tests/unit/categorize.test.ts`); the webhook JWT verifier with an injected key
resolver (`tests/unit/plaid-webhook.test.ts`); and the Plaid error-envelope
formatter (`tests/unit/plaid-errors.test.ts`). What is now **VERIFIED live**
(2026-07-09, `npm run plaid:validate`): the `plaid.ts` network orchestration for
exchange → `/accounts` → `/transactions/sync` → `/liabilities/get` against the real
sandbox. Still UNVERIFIED: the interactive browser Link UI and the live webhook
round-trip. When you re-run §5, spot-check that live transactions carry `personal_finance_category`
with the `{primary, detailed, confidence_level}` shape the mapper expects (older
items may omit it — the row then simply falls through to our own review path).

**Hardening applied (this pass):** signed `balances.current` (overpaid card /
overdrawn account no longer inverts net worth); Link initializes `transactions`
with `liabilities` as `required_if_supported_products` (depository-only banks no
longer filtered out of Link); Plaid error envelopes surfaced on failed calls
(diagnosable first run); `exchangePublicToken` upserts the item (a link that
fails mid-flight stays retryable); per-item fault isolation in `syncTransactions`
(one item needing re-auth doesn't block the rest); `/transactions/sync` upserts
the `accounts` it echoes (an account added post-link can't become a silent ledger
gap); unmappable accounts skipped + audited, not fatal; expired webhook keys
rejected; constant-time webhook body-hash compare; dead `development` host removed.

**Known limitations (real, by design for now):** only credit-card liabilities are
mapped to `Statement`s — student-loan and mortgage liability objects are not
ingested. A paid-in-full card with a null `next_payment_due_date` yields no
statement, so the cash-needed assembler uses its estimate path (same as a card
whose statement hasn't closed). Demo mode is entirely unaffected by all of the
above. Run §5 to validate before trusting this with real money.

## Sandbox rejects REAL input inside Link (#256 — owner hit this live)

With `PLAID_ENV=sandbox` (the default), Plaid's hosted Link UI only accepts
Plaid's own **test** input. A real bank search may work, but real credentials are
rejected, and a **real phone number on Link's SMS step is rejected by Plaid
itself** ("phone number is invalid") — nothing in our code sees or validates the
phone number (we send no `user.phone_number` and no identity-verification config
in `/link/token/create`; see `linkTokenParams` in `src/lib/providers/plaid.ts`).
Use Plaid's documented sandbox test credentials (`user_good` / `pass_good`) and
Plaid's documented sandbox test phone number / OTP for any SMS step (see Plaid's
Sandbox docs — the values are Plaid's, not ours, so they are not pinned here).
Linking a REAL bank requires production keys (`PLAID_ENV=production`). The
connect button now shows this notice inline whenever the minted link token came
from a non-production environment (`plaid-sandbox-notice`).

## Disconnecting a bank (#256)

Each linked Plaid item renders a row on /accounts ("Plaid: <institution> · last
synced …") with a two-tap **Disconnect** — `disconnectPlaidItem` revokes the
access token at Plaid (`/item/remove`), deletes the local `PlaidItem`, and keeps
already-synced accounts + history (the SimpleFIN precedent). Once an item is
gone, its accounts grow the per-account **Delete** control (#253's guard, now
reachable for Plaid): a row deletes only when the connection that could
resurrect it is gone — per-item precision via `Account.plaidItemId` (stamped on
every sync and best-effort at disconnect), with a conservative all-items-gone
rule for legacy rows that never re-synced after the column shipped.

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
- **Sign convention flip** (tested): Plaid amounts are outflow-POSITIVE; Aimplifi
  stores outflow-NEGATIVE — `plaidAmountToCents` negates on ingest.
- **`POST /transactions/get`** (date-ranged) is called by exactly ONE path: the
  on-demand O.12d repair (`PlaidProvider.backfillProviderCategories`, invoked via
  `/api/repair/plaid-provider-categories` with the CRON_SECRET bearer — never
  scheduled). `/transactions/sync` never re-sends a delivered row, so rows ingested
  before the provider-guess columns existed (L.12, 2026-07-24) carry permanent
  nulls; `/transactions/get` DOES return delivered rows, and the repair fills the
  two provider-guess columns — null-only, exact-match-or-skip, verdicts untouched.
- Re-runs until `has_more` is false. After ingest, `refreshTransferFlags`
  re-derives `isTransfer` across the user's full set (descriptor + pair matching),
  then `refreshRecurringForUser` re-detects recurring series + scheduled
  projections (DECISIONS #22 tail) best-effort — a derived-view failure never
  fails the ingest itself.
- Each item syncs inside its own try/catch: a single item in an error state (e.g.
  `ITEM_LOGIN_REQUIRED`) is audited as `plaid.item.sync.failed` with its cursor
  left unadvanced, and the remaining items still sync.
- Triggered by the webhook (`/api/plaid/webhook`, TRANSACTIONS) and by the cron
  sweep (`/api/cron/sync`, `Authorization: Bearer $CRON_SECRET`).

## 4. Liabilities → statements

- `POST /liabilities/get` → for each credit card:
  `last_statement_balance` → `statementBalanceCents`,
  `minimum_payment_amount` → `minimumPaymentCents`,
  `next_payment_due_date` → `dueDate`,
  `last_statement_issue_date` → `cycleEnd`.
- Autopay flags from `is_overdue`/issuer data are NOT provided by Plaid —
  autopay config remains a user setting in Aimplifi.

## 5. Validation

**Automated (headless, no Link UI):** with sandbox credentials in `.env.local`,
run `npm run plaid:validate`. It drives the real `PlaidProvider` end to end via
`/sandbox/public_token/create` — exchange (encrypted `PlaidItem`), `/accounts`,
`/transactions/sync` (with sign assertions), `/liabilities/get` — against a
throwaway test user, prints real counts/samples, asserts, and cleans up. This
flips the integration from UNVERIFIED to verified for the network paths it
exercises. Paste its real output as the evidence.

**Manual checklist (full Link UI + production concerns):**
- [ ] `npm run plaid:validate` prints `✅ VALIDATION PASSED`
- [ ] Token row encrypted in `PlaidItem` (inspect DB: no plaintext)
- [ ] Sync inserts transactions with correct signs and dates (asserted by the script)
- [ ] Liabilities populate statements; cash-needed headline computes
      (the script now FAILS if a credit account yields zero statements)
- [ ] Real Link UI flow (browser) for a human-linked item
- [ ] Webhook triggers an incremental sync (JWT verification already implemented +
      unit-tested — confirm it fires end-to-end against a real Plaid webhook)
- [ ] `/item/remove` + cascade delete leaves zero user rows
