## §Ask wealth-target parse (DECISIONS #484 — W.4)

No new money math — `solveWealthTarget` is W.1. What this slice adds is the spoken amount
and the route. Integer cents, hand-checked:

- `10 mil` / `$10M` / `ten million` → **1,000,000,000c** ($10,000,000.00)
- `a million` / `one million` → **100,000,000c**
- `2 million` (digit + magnitude, pre-existing) → **200,000,000c**

Abstain (null, never a guess): `twenty five million` (would have read "five");
`half a million`; `ten million steps`; `save 15000` (bare ungrouped, #126);
comparison / negation (`10 mil or 20 mil`, `not 10 million`). A named date
stays on `savings_goal_by_date`. Locked in `tests/unit/assistant-wealth-target.test.ts`.
