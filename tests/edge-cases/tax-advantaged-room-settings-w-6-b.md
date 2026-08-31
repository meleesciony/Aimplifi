## §Tax-advantaged contribution room Settings (W.6(b) follow-up — DECISIONS #529)

Room is a **rung**, not an IRS dollar limit and not a vehicle (Roth vs 401(k) vs HSA).
The Settings card stores a closed status; `parseTaxAdvantagedRoom` is the one boundary.
Fail-safe is **skip** (`unknown`) — a missing or garbage column must never rank as
"fill remaining room." `remaining` wins only after revolving, uncaptured match, the
runway floor, and installment APR above the return — it names the envelope before
taxable investing.

| # | Input | Result |
|---|--------|--------|
| TR1 | `''` / `'unknown'` / null / whitespace | `unknown` |
| TR2 | `'remaining'` / `'maxed'` / `'none'` (trimmed) | same token |
| TR3 | `'yes'` / `'7000'` / `'REMAINING'` / `'has_room'` | `unknown` (never invent remaining) |

Column: null stores `unknown`. Demo writes are fenced. Employer match stays its own card.
