## SimpleFIN holdings — authoritative total vs per-share round-trip (DECISIONS #129, live-ingest backlog #5)

SimpleFIN reports a position's TOTAL `market_value` + a share count. A Holding stores a per-share
`priceCents` for display AND the authoritative `marketValueCents` total. The engine
(`valuePosition`) uses `marketValueCents` verbatim when present; a manual holding (no total) derives
`round(quantity × priceCents)`. The bug #5 fixes: storing ONLY a rounded per-share price loses
low-price / high-quantity lots. All values hand-verified.

### H-A. Penny lot — per-share rounds to $0 but the position is worth 1¢
1,000,000 shares, `market_value` "$0.01" (1¢ total). priceCents = round(1 ÷ 1,000,000) = round(0.000001)
= **0**. Per-share-only model: marketValue = round(1,000,000 × 0) = **$0.00** (WRONG — the position
disappears). Authoritative model: marketValueCents = **1** (1¢, exact). The fix's headline case.

### H-B. Sub-dollar lot — per-share rounding inflates ~2×
10,000 shares, `market_value` "$50.00" (5,000¢ total) → $0.005/share. priceCents = round(0.5) = **1**
(half-away-from-zero). Per-share-only model: round(10,000 × 1) = 10,000¢ = **$100.00** (2× the truth).
Authoritative model: **5,000¢** = $50.00, exact.

### H-C. VOO sub-cent drift — the documented #124 9999 is now exact
3 shares, `market_value` "$100.00", `cost_basis` "$90.00". priceCents = round(10,000 ÷ 3) = round(3,333.33)
= **3,333**. Per-share-only model: round(3 × 3,333) = **9,999¢** (the #124 documented −1¢ drift).
Authoritative model: **10,000¢** exact; unrealized gain = 10,000 − 9,000 = **1,000¢** off the real total.

### H-D. Clean lot — round-trip already exact (no behavior change)
10 shares, "$2,000.00" → priceCents = round(200,000 ÷ 10) = 20,000; derived round(10 × 20,000) =
200,000 = authoritative 200,000. For whole-cent-divisible lots the two models agree, so the common case
is unchanged.

### H-E. Manual holding — null total, derive path (golden-safe)
A hand-entered holding carries no `marketValueCents` (null). The engine derives
`round(quantity × priceCents)` exactly as before, so the demo seed portfolio (5 manual holdings summing to
$142,000.00) and every golden value are byte-identical. `addHolding` writes `marketValueCents: null` on
create AND update, so re-entering a previously-fed symbol by hand clears the stale feed total and the
user's per-share price wins.

### Net-worth invariant (unchanged)
Net worth and /coach `portfolioCents` use each INVESTMENT account's authoritative
`currentBalanceCents`, NOT `summarizePortfolio`. So this change touches ONLY the /investments
position breakdown (totals, allocation weights, unrealized gain) — never net worth, FI, retirement,
goals, or any dashboard golden.

### H-F. DB Int column ceiling — a single position over $21,474,836.47 is skipped, not silently dropped (critic P1-1)
A persisted cents column is Prisma `Int` = Postgres 32-bit INTEGER, max **2,147,483,647¢** = $21,474,836.47
per position. A SimpleFIN total above it would overflow the column and be SWALLOWED by the reconcile's
per-row try/catch — vanishing from /investments in production (invisible on 64-bit SQLite in CI). So the
mapper bounds **every** persisted value (priceCents, costBasisCents, marketValueCents) to this ceiling:
e.g. 1,000 sh @ "$22,000,000.00" → total 2,200,000,000¢ > ceiling → **skipped + counted** (priceCents
$22,000 fits, but the total doesn't). Boundary: "$21474836.47" (= 2,147,483,647¢) is KEPT; "$21474836.48"
is skipped. Degrades visibly (skip count), never a silent vanish. Widening these totals to BigInt is the
documented follow-up if such single positions come into scope (the cost-basis column has always had this
same ceiling).

### H-G. Approximate per-share display — the row never contradicts its authoritative total (critic NWBR-1)
For a sub-cent / fractional lot the rounded per-share price can't rebuild the authoritative total
(`round(quantity × priceCents) ≠ marketValueCents`): 10,000 sh / $50.00 shows "$0.01/share" but the total
is $50.00 (not 10,000 × $0.01 = $100). The pure `isPerShareApproximate` flags exactly this case, and the
/investments row renders "≈$0.01" so the per-share figure reads as approximate beside the exact total. For
a derived (manual) position the two agree by construction → not flagged. Demo seed lots are all
whole-cent-divisible → never flagged → display unchanged.
