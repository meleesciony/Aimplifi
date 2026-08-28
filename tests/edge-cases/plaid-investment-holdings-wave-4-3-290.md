## Plaid investment holdings (Wave 4.3, #290)

The Plaid /investments/holdings/get mapper (src/lib/providers/plaid-holdings.ts) mirrors the
SimpleFIN holdings model (DECISIONS #129): the feed's institution_value (a position's TOTAL
market value) is the authoritative marketValueCents, and the per-share priceCents is DERIVED as
round(marketValueCents / quantity) -- never Plaid's own institution_price. quantity is Float
shares; cost basis is best-effort.

Hand-verified maps (dollars in -> integer cents out):
- AAPL, quantity 100, institution_value $20,000, cost_basis $15,000 ->
  marketValueCents 2000000 (authoritative), priceCents round(2000000/100)=20000, costBasisCents 1500000.
- VTI, quantity 200, institution_value $50,000, cost_basis $40,000 ->
  marketValueCents 5000000, priceCents round(5000000/200)=25000, costBasisCents 4000000.
- Penny lot (DECISIONS #129 parity): quantity 1,000,000, institution_value $0.01 ->
  marketValueCents 1 (authoritative), priceCents round(1/1000000)=0. The 1c total survives; a
  per-share-only model would reconstruct round(1000000 x 0)=$0 and lose the position.
- Same-symbol aggregation: two AAPL lots (100sh/$20,000/$15,000 + 50sh/$10,000/$8,000) ->
  one position quantity 150, marketValueCents 3000000, costBasisCents 2300000,
  priceCents round(3000000/150)=20000.

Edge-case rules (each with a test in tests/unit/plaid-holdings*.test.ts):
- Cash sweep (security.type='cash', e.g. ticker CUR:USD): DROPPED, and NOT counted skipped --
  it is not a security position (its value is already inside the account balance).
- Non-USD lot (iso_currency_code not USD, or a crypto unofficial_currency_code): WITHHELD (no
  FX), counted withheldNonUsd (distinct from skipped), never persisted, never summed at 1:1.
- Short/zero quantity, non-finite or negative value, over-ceiling (> $21,474,836.47 = the 32-bit
  Int cap), or a real security with no usable ticker: SKIPPED + counted, never thrown.
- Un-joinable security (security_id absent from securities[]): SKIPPED (cannot key it).

Reconcile safety (PlaidProvider.reconcilePlaidHoldings + the syncHoldings guard):
- Source isolation: writes/deletes ONLY source='plaid' rows; a manual (or other-provider) row of
  the same ticker is off-limits to both the upsert and the delete.
- Prune (delete sold positions) runs ONLY on a CLEAN run (skipped===0): an explicit-empty,
  cash-only, or all-foreign account prunes correctly (sold-all); a run that left un-mappable rows
  (skipped>0 -- e.g. a truncated securities[]) upserts what it can but deletes NOTHING, so a
  still-held position whose security row was dropped this run is never mistaken for sold.
- A malformed 200 (missing/null/non-array holdings) is NOT read as sold-all: syncHoldings leaves
  every account's rows intact and audits plaid.holdings.malformed (the SimpleFIN Array.isArray
  guard, #128 transactions:null hazard).
