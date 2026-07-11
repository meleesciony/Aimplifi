> **HISTORICAL** — self-labeled disposable session handoff, superseded by later `PROGRESS.md`
> HANDOFF entries and `docs/STATUS.md`. Kept for provenance only.

# Session Context / Handoff — 2026-06-27 (session "aimplifi": live brokerage-holdings ingest #124)

Self-contained context to resume after a `/clear`. Files persist on disk; clearing the
conversation deletes nothing. Point the new session at this file, then `PROGRESS.md` (the
`#124 — IN PROGRESS` entry at the bottom has the step-by-step resume checklist).

## ✅ STATE: DONE — committed, verify-green, hostile-critic clean. SAFE to /clear.

The increment is complete and committed. `bash scripts/verify.sh` → GREEN (1229 unit/99 files,
typecheck/lint/build clean); full e2e 56/56 + investments 4/4 (axe AA). Two-Checker hostile critic
ran (wf_58c29acd): the one confirmed P0 (same-ticker upsert overwriting a manual holding) is FIXED +
regression-locked; a transient-empty data-loss P2 is FIXED; remaining P2s closed or documented.
Working tree CLEAN. Local main is ahead of origin `12ad163` (LIVE) by the deploy-record docs commit
(`c93e794`) + this #124 commit — **UNPUSHED** (push is the owner's call; it deploys the holdings-ingest
path, and the live SimpleFIN holdings field stays UNVERIFIED until a real token confirms it).
Full detail: PROGRESS.md "#124 — DONE ✅" + DECISIONS.md row 124.

**Work from `C:\dev\Aimplifi`** (canonical checkout; OneDrive + `C:\dev\Pulse Finance` are abandoned).

## The increment

Roadmap's explicitly-named LATER item: **live brokerage-holdings ingest** — real positions from a
connected SimpleFIN INVESTMENT account → the `Holding` model → the tested portfolio engine
(`src/lib/engine/investments/portfolio.ts`). The natural continuation of the investments arc
(#77 engine → #78 model/server → #80 view → #122/#123 retirement planner).

## Design (LOCKED — do not re-derive)

1. **Wire shape.** SimpleFIN `/accounts` returns an optional `holdings[]` on investment accounts;
   each holding is decimal STRINGS: `symbol?`, `shares`, `cost_basis?`, `market_value`, `description?`,
   `purchase_price?` (unused — it's a COST per share, not current). Modeled now as `SimplefinHolding`
   in `simplefin-map.ts`, with `holdings?: SimplefinHolding[]` added to `SimplefinAccount`.
2. **Per-share derivation.** The Pulse `Holding` stores a per-share `priceCents`; the engine computes
   `marketValue = round(quantity × priceCents)`. SimpleFIN gives a TOTAL `market_value` + `shares`, so we
   derive `priceCents = round(market_value ÷ shares)`. Whole-cent-divisible positions round-trip exactly;
   odd fractional lots can differ from the SimpleFIN total by sub-cent × shares — negligible, documented,
   and it NEVER affects net worth.
3. **Net worth is untouched.** Net worth uses the authoritative `account.currentBalanceCents` (refreshed
   every sync). Holdings are a *within-account breakdown* shown on `/investments`. So this increment is
   purely additive and cannot move the dashboard net-worth golden.
4. **Reconciliation without data loss.** Added `Holding.source @default("manual")`. A SimpleFIN sync
   upserts incoming positions as `source='simplefin'` and deletes stale `source='simplefin'` rows (sold
   positions) — it NEVER touches `source='manual'` holdings on the same account. Default `'manual'` ⇒
   existing + demo-seeded rows keep their meaning, so demo/golden is byte-identical and the seed is untouched.
5. **Resilience.** `mapSimplefinHoldings` is pure + total: a single un-mappable position (no usable
   symbol/shares/value, or out of safe-integer range) is SKIPPED and COUNTED, never thrown — one weird row
   can't lose the whole portfolio (mirrors the transaction-skip idiom already in `syncFromSimplefin`).
   Bounds are kept identical to `server/investments.ts::addHolding`, so a synced row can never be one
   addHolding would reject (nor one the engine throws on).
6. **UNVERIFIED live path.** No SimpleFIN token in this env, so the live network call is UNVERIFIED —
   consistent with the existing SimpleFIN/Plaid live-path labeling. Unit + mocked-server integration cover
   every ledger-affecting code path.

## Files touched so far (UNCOMMITTED)

- `prisma/schema.prisma` — `Holding.source String @default("manual")`. Ran `npx prisma generate` (client
  regenerated so `tsc` sees the field; unit/e2e test DBs get the column via their `prisma db push`
  global-setups: `tests/setup/wal-global-setup.ts` and `tests/e2e/global-setup.ts`).
- `src/lib/providers/simplefin-map.ts` — `SimplefinHolding` type + `holdings?` on `SimplefinAccount`.
- `src/lib/providers/simplefin-holdings.ts` (NEW) — pure `mapSimplefinHoldings(raw) → { holdings, skipped }`.

## Remaining steps — see `PROGRESS.md` "#124 — IN PROGRESS" for the numbered checklist (steps 4–9)

4. pure mapper tests → 5. wire `simplefin.ts` sync (INVESTMENT branch ~line 232) + `SyncResult`/`SimplefinResult`
counters → 6. mocked-server integration tests → 7. `verify.sh` (+`VERIFY_E2E=1`) green → 8. hostile critic
(engine math + integration/data-loss Checkers) → 9. DECISIONS #124 + ROADMAP done + commit.

## Key idioms (so resume doesn't re-explore)

- **Mapper money helpers**: `simplefinAmountToCents` (commas, >2dp, half-up, signed), `roundHalfAwayFromZero`,
  `cents()` (throws on non-safe-int) — all in `simplefin-map.ts` / `money.ts`.
- **Sync hook**: `src/lib/providers/simplefin.ts` Pass-1 loop, `if (mapped.type === 'INVESTMENT' || 'LOAN') continue;`
  — ingest holdings for INVESTMENT just before that `continue`. Account upsert key `(userId, provider, providerRef)`;
  holdings upsert key `(accountId, symbol)` via `prisma.holding.upsert({ where: { accountId_symbol } })`.
- **Test DB**: SQLite in OS temp dir (off OneDrive), WAL, `fileParallelism:false`, 20s timeouts (vitest.config.ts).
- **Integration idiom**: `tests/unit/simplefin.test.ts` (vi.mock('@/auth'), vi.mock('next/cache'),
  vi.stubGlobal('fetch', mockServer returning Response-likes), throwaway user `sf-...-${Date.now()}-${process.pid}`).
- **e2e golden**: `/investments` total `$142,000.00`, an `AAPL` holding row (tests/e2e/investments.spec.ts) — must
  stay green (demo never uses SimpleFIN, so synced holdings can't affect it).

## Repo state

- Branch `main`. HEAD `c93e794` (deploy-record docs commit), **1 ahead of origin `12ad163`** (LIVE at aimplifi.app:
  #122 retirement planner + #123 editable what-if).
- Baseline before this increment: `verify.sh` → GREEN, **1200 unit / 97 files**.
- Working tree: the 3 edits above are UNCOMMITTED. **Safe to /clear** (disk persists); resume from this file + PROGRESS.
- Do NOT change the seed RNG `pulse-finance-seed` or demo email `demo@pulse.finance` (pins golden values).
