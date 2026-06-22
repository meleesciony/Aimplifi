# SimpleFIN — getting your real data in without Plaid

SimpleFIN is a cheaper, privacy-first bank-data service. Unlike Plaid it has no
business onboarding/approval gate and costs a few dollars a year. Pulse talks to it
over a dead-simple read-only HTTP protocol and stores only an **encrypted access
URL** — never your bank password (SimpleFIN holds that, not us).

## ⚠️ Status: implemented, live path UNVERIFIED

The SimpleFIN protocol here was implemented from the documented spec as of the
**Jan-2026 knowledge cutoff** and has **never run against a live SimpleFIN server**
in this build (there's no token in the environment). The parts that would corrupt
your ledger if wrong — sign convention, cents, dates, account-type inference,
categorization, dedup — are unit-tested (`tests/unit/simplefin-map.test.ts`), and the
claim+sync orchestration is tested against a mocked server (`tests/unit/simplefin.test.ts`).

**Before trusting it with real money data, confirm the field shapes against the current
SimpleFIN spec** (`https://www.simplefin.org/protocol.html`), specifically:
- the `/accounts` JSON shape (`accounts[].{id,name,balance,org,transactions[]}`),
- transaction `amount` sign (we assume **negative = money out**, no flip — same as Pulse),
- `posted` being a **unix timestamp in seconds**,
- the setup-token → claim-URL → access-URL exchange (base64 decode → POST → access URL).
If any differ, adjust `src/lib/providers/simplefin-map.ts` / `simplefin.ts` and the tests.

## How to turn it on

1. **Set an encryption key** (the access URL carries read-only credentials, so it's
   AES-256-GCM encrypted at rest — connecting is refused without this):
   ```
   DATA_ENCRYPTION_KEY=<32 bytes, base64>     # openssl rand -base64 32
   ```
2. **Get a setup token** from SimpleFIN (simplefin.org / a SimpleFIN Bridge): create an
   account, connect your bank(s), and copy the **one-time setup token**.
3. In Pulse: **Accounts → "+ Connect a bank (SimpleFIN)"** → paste the token → Connect.
   Pulse claims the token (single-use → a permanent access URL), encrypts + stores it,
   and pulls your accounts + transactions. Use **Sync now** to refresh, **Disconnect**
   to remove the link.

## What it does / doesn't do

- Accounts arrive as `provider='simplefin'` rows and flow into net worth, the register,
  cash-needed, the FI coach, reminders — everything — automatically.
- Transactions run the same normalize → rules → categorize → transfer pipeline as Plaid,
  and recurring/subscription detection refreshes after each sync.
- Re-syncing is **idempotent** (deduped by SimpleFIN transaction id), with a few days of
  overlap so late-posting transactions aren't missed.

### Known limitations
- **Account type is inferred from the account name** (SimpleFIN has no standard type
  field). It's now hardened: an ambiguously-named account with a **negative balance** is
  treated as a liability (so its net-worth sign can't silently invert), and the connect UI
  shows a "double-check cards/loans are under Liabilities" notice. Still worth a glance.
- **SSRF guard is hostname-based** (https-only; no loopback/private/link-local/ULA in IPv4
  **or** IPv6; re-checked on every redirect hop, and creds are dropped on a cross-host
  redirect). It does NOT defend against DNS rebinding — acceptable for a user pasting their
  own token; pin-the-resolved-IP is the further hardening.
- No scheduled auto-sync yet; "Sync now" is manual (a cron route could call it later).
- Re-sync is idempotent and race-safe (DB `@@unique([accountId, providerRef])`), and
  cross-account transfer pairing runs after ingest (parity with Plaid).
