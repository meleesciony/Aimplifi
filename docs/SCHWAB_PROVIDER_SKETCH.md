# SchwabProvider — Design Sketch (PLAN ONLY, not built)

> Generated 2026-06-26 by a 4-agent design workflow: parallel survey of the
> alpha_engine Schwab integration (`C:\Users\micha\alpha_engine\broker_sync.py`)
> and the Pulse Finance provider/investments seam → synthesized design →
> adversarial feasibility review. **Nothing here is implemented.** This is a
> reviewable plan; build it phase-by-phase (S0→S5) only when you decide to.
>
> Key framing up front: the Schwab Trader API is **first-party and scoped to your
> own accounts** — it can pull *your* Schwab brokerage balances/holdings, but it
> is **not a bank aggregator** (no other banks) and **not a "share with friends"
> feature** (each person would need their own Schwab developer app). It's a
> first-party complement to Plaid/SimpleFIN on the investments side.

---

## Survey note

The entire Schwab integration in alpha_engine lives in one module,
`broker_sync.py` (354 lines) — `alphafinder.py` / `alpha_engine_desktop.py`
contain no Schwab code. It's a **desktop loopback OAuth app**
(`redirect_uri = https://127.0.0.1:8182`) that connects the developer's own (and
spouse's) accounts as separate profiles, GETs `/accounts` only (no order
endpoints), and fails loud (`SystemExit`) on any error, never writing partial data.

---

## 1. Scope

**CAN ingest** (your own Schwab brokerage login, read-only):
- **Balances** — per-account cash from `securitiesAccount.currentBalances` → `Account.currentBalanceCents` / `availableBalanceCents`.
- **Positions / holdings** — `securitiesAccount.positions[]` (EQUITY / ETF / COLLECTIVE_INVESTMENT) → `Holding` rows. **This is the differentiator: neither Plaid nor SimpleFIN writes `Holding` rows — SchwabProvider would be the first.**
- **(Deferred)** Trade transactions from `/accounts/{hash}/transactions?types=TRADE`.

**CANNOT / will not do:** non-Schwab banks/cards/loans (those stay with Plaid/SimpleFIN); spending/cash-flow transactions for the Cash-Needed engine (INVESTMENT accounts' transactions are filtered out of that engine anyway); any write/order path.

---

## 2. File layout

New files (mirroring how `plaid.ts` / `simplefin.ts` split orchestration vs pure mapping):

| File | Role |
|---|---|
| `src/lib/providers/schwab.ts` | `SchwabProvider` class implementing `DataProvider`; pull → Prisma writes; reads delegate to `DemoProvider`. |
| `src/lib/providers/schwab-map.ts` | **Pure** functions: raw Schwab JSON → row shapes + dollars→cents. No I/O. Unit-tested. |
| `src/lib/providers/schwab-client.ts` | Thin HTTP layer: token exchange/refresh + GET `/accounts?fields=positions`; `fetch` injectable for tests. |
| `src/server/schwab-actions.ts` | Server actions: `beginSchwabAuth`, `completeSchwabAuth(code)`, `syncSchwab()`, `disconnectSchwab()`. |
| `docs/SCHWAB_WALKTHROUGH.md` | Operator setup (register Schwab app, env vars, re-auth). |

Existing files that change: `prisma/schema.prisma` (add `SchwabConnection` model + `User.schwab` back-relation), `src/lib/providers/demo.ts` (`which === 'schwab'` branch in `getProvider()`), `.env.example` (`SCHWAB_APP_KEY`, `SCHWAB_APP_SECRET`, `SCHWAB_REDIRECT_URI`), plus `schwab-map.test.ts` / `schwab.test.ts`.

---

## 3. Auth & token strategy

- **Own Schwab app, not alpha_engine's.** Register a new Schwab developer app for fresh `app_key`/`app_secret`; do not reuse the desktop loopback creds.
- **Flow** (Authorization Code, same mechanism as `broker_sync.py`'s `_token_request`): `beginSchwabAuth` builds the consent URL → Schwab calls back with `code` → `completeSchwabAuth` POSTs `grant_type=authorization_code` with Basic `base64(app_key:app_secret)` → persist tokens **encrypted** into `SchwabConnection`.
- **Token storage** (`SchwabConnection`): `userId`, encrypted `accessToken` + `refreshToken`, `expiresAt`, `needsReauth`, `lastSyncedAt`.
- **Refresh** (port of `_access_token`): before any call, if `now >= expiresAt − 120s`, POST `grant_type=refresh_token` and **re-save the whole token blob** (Schwab may rotate the refresh token — persist the new one re-encrypted every refresh).
- **7-day refresh expiry — explicit, not silent.** A >7-day idle gap forces re-consent. On `400 invalid_grant`, set `needsReauth = true`, leave existing rows untouched, surface a "Reconnect Schwab" prompt — **do not throw into the app** (inverts alpha_engine's `SystemExit`).
- **Dormancy.** Env-gated + lazy-`require`d in `getProvider`; a blank `.env` still builds/runs on `DemoProvider`.

---

## 4. Data mapping (Schwab JSON → Prisma)

All money arrives as **dollar floats**; convert to integer cents exactly once at the `schwab-map.ts` boundary, round half-away-from-zero. Account → one per `securitiesAccount` (`type:'INVESTMENT'`, `providerRef = hashValue`, `mask` = last-4). Holding → per kept position (`symbol`, `quantity = long − short`, `priceCents`, `costBasisCents = averagePrice × qty`), upsert on `@@unique([accountId, symbol])` — the exact key `addHolding` uses. See the feasibility findings below before trusting the balance formula.

---

## 5. DataProvider contract

`SchwabProvider implements DataProvider`: `today()` / `listAccounts()` / `getStatements()` / `getFinanceSnapshot()` all **delegate to `DemoProvider`** (DB is source of truth post-sync); `syncTransactions()` is **repurposed as the Schwab pull** (refresh token → `/accounts/accountNumbers` for `hashValue` → `/accounts?fields=positions` → map → upsert Account + diff Holdings; returns counts of *holdings*; `nextCursor: null`). Deliberate no-ops: bank-transaction sync, statements, order writes.

---

## 6. Test plan

Pure mapping tests (`schwab-map.test.ts`, from captured JSON fixtures, no network) + mocked-fetch orchestration tests (`schwab.test.ts`: refresh fires at the threshold; `invalid_grant` → `needsReauth`, zeros, no throw; idempotent re-sync; holdings diff-delete; reads delegate to demo; tokens never logged). Live network = a manual, **UNVERIFIED**, never-in-CI script.

---

## 7. Phased build plan (each ends at `bash scripts/verify.sh` green)

- **S0** — Schema + dormancy (model, `getProvider` branch with env-guard + lazy-require stub, `.env.example`). Gate: blank-env verify green, demo still default.
- **S1** — Pure mapping + tests.
- **S2** — Client + token lifecycle (Basic-auth exchange, proactive refresh, encrypted storage, `needsReauth`).
- **S3** — Provider orchestration (pull → Account + Holding upsert/diff; reads delegate).
- **S4** — Server actions + minimal UI (connect button, re-auth banner, manual "Sync now"); simulated/Playwright flow asserting holdings land in `getInvestments()`.
- **S5 (DEFERRED)** — Trade-transaction ingest + quotes-based price refresh.

---

## 8. Adversarial feasibility review — verdict: **sound-with-fixes**

The design read the real seam and mirrors Plaid/SimpleFIN accurately; the DataProvider fit is correct and dormancy/verify is sound (`crypto.loadKey()` is call-time, not import-time, so the blank-env demo build stays green as long as no Schwab module reads env at module load). The genuinely important findings:

1. **(P1) Direct `Holding` writes bypass `addHolding`'s guards → one bad row crashes the whole investments page.** `summarizePortfolio` → `valuePosition` throws on overflow, un-caught across the map, so a single garbage/oversized position takes down `getInvestments()` for the user. **Fix:** replicate `addHolding`'s guards (safe-integer non-negative cents, finite `quantity > 0`, `abs(quantity × priceCents) ≤ MAX_SAFE_INTEGER`) in `schwab-map.ts` and skip+count failures; add overflow tests.
2. **(P1) Holdings diff-delete + "return zeros on error" = portfolio-wipe hazard.** A partial/failed pull (network blip, reauth mid-flight, empty `positions[]`) is indistinguishable from "all liquidated" → the diff deletes the entire portfolio. **Fix:** only diff-delete after a verified-complete, fully-successful pull; on any error/`needsReauth`, leave all rows untouched and return zeros without diffing. (Graceful for reads, fail-safe for deletes.)
3. **(P1) `currentBalanceCents = cash + Σ marketValue` double-counts the money-market sweep.** SWVXX sits under `mutualFundValue` (in the cash term) *and* appears as a `COLLECTIVE_INVESTMENT` position. **Fix:** prefer Schwab's own `currentBalances.liquidationValue` for the account total (capture from a live response — currently unsurveyed).
4. **(P1, realism) Self-hosted single-operator model only.** Schwab's individual developer program is scoped to *your own* accounts. A hosted Pulse onboarding arbitrary users through one Schwab app generally needs a commercial/registered-advisor agreement + app review — a much bigger hurdle than registering an app. **Fix:** scope SchwabProvider to "you register your own Schwab app for your own accounts," document it in the walkthrough, and reconsider whether the HTTPS `/api/schwab/callback` route is even needed vs. the loopback/paste flow for a local-first product.
5. **(P2)** Store token `expiresAt` as epoch-millis `Int`/`DateTime`, not a YYYY-MM-DD string; compute refresh with real `Date.now()`, **not** `today()`/`businessToday()` (which `DEMO_TODAY` can pin and freeze refresh timing).
6. **(P2)** `priceCents = marketValue/netQty` is a lossy `Int` reconstruction; the engine recomputes `round(qty × priceCents)`, so holdings won't reconcile to the penny with `currentBalanceCents`. Label it an estimate.
7. **(P2)** `SchwabConnection.userId @unique` (one login/user) contradicts alpha_engine's multi-profile reality (you + spouse). The `PlaidItem` many-per-user template fits better; one-per-user is a defensible MVP but call out the limitation.
8. **(P2)** Schwab returns dollar **floats** (already float64 after `JSON.parse`), so `Math.round(x*100)` can mis-round `x.005` — SimpleFIN avoids this by decimal-parsing strings. Document the single rounding boundary and the sub-cent imprecision honestly.
9. **(P2)** Spell out the join: `providerRef = hashValue` comes from `/accounts/accountNumbers`, positions from `/accounts?fields=positions` — join by `accountNumber`.
10. **(P2)** `SyncResult` returns *holdings* counts through transaction-named fields — label the "Sync now" UI as holdings; fix `mask` last-4 vs name last-3; the symbol regex rejects `BRK/B`-style tickers (enforce in `schwab-map.ts` and skip+count, or drop the claim).
11. **(P2)** "INVESTMENT accounts are filtered out of the snapshot" is imprecise — only their *transactions* are filtered; the account rows themselves are returned (and feed net worth). Conclusion holds; reword the premise.

---

## Recommended path

If/when you build this: do **S0 first** (schema + dormant stub, blank-env verify green) so it's wired but inert, then S1 mapping with the P1 #1 guards baked in from the start, and bake P1 #2 (fail-safe deletes) into S3. Treat it as a **you-only investments feature**, not something friends connect through. It does not replace Plaid/SimpleFIN for banks.
