## §Ask Timeframes: bare years, since, ranges, numeric dates (DECISIONS #230 — TASKS 2.7, `parseExplicitTimeframe`)

All hand-verified with `today = 2026-07-14` (so the current year is 2026 and the
current month is July). Windows are inclusive month-key ranges `[fromYm, toYm]`.

| Input | Window | Label | Why |
|---|---|---|---|
| "in 2025" | 2025-01 … 2025-12 | `in 2025` | a past year is that whole calendar year |
| "in 2026" | 2026-01 … 2026-07 | `2026 so far` | the current year runs through today (the YTD window) |
| "in 2027" | — (abstain) | — | a FUTURE year is not a window; a past-tense figure under it answers a different question |
| "since 2024" | 2024-01 … 2026-07 | `since 2024` | "since" runs through today |
| "since march" | 2026-03 … 2026-07 | `since March 2026` | most recent past occurrence (March ≤ July) |
| "since september" | 2025-09 … 2026-07 | `since September 2025` | September > July → last year's |
| "since last month" | 2026-06 … 2026-07 | `since last month` | spans both months (the bare "last month" rule alone claimed June only) |
| "since last year" | 2025-01 … 2026-07 | `since last year` | last January through today (critic F5) |
| "between 2024 and 2025" | 2024-01 … 2025-12 | `in 2024–2025` | both years, whole span |
| "from 2024 to 2026" | 2024-01 … 2026-07 | `since 2024` | a range ending in the CURRENT year IS "since lo" — labeled so, so frame staleness re-labeling covers it (critic F8) |
| "between 2024 and 2027" | — (abstain) | — | a future endpoint poisons the whole set; never half-answer 2024 |
| "on 3/5" | 2026-03 … 2026-03 | `March 2026` | US M/D → the containing MONTH window (the shipped worded "on March 5" rule); March ≤ July → this year |
| "on 12/25" | 2025-12 … 2025-12 | `December 2025` | December > July → last year's |
| "in 3/2025" / "on 3/5/2025" | 2025-03 … 2025-03 | `March 2025` | explicit year |
| "on 13/5" / "on 3/45" / "on 2/30" / "on 3/5/26" | — (abstain) | — | invalid month (we never guess DD/MM), invalid day, two-digit year |
| "in march 2027" / "since march 2027" | — (abstain) | — | an explicitly-dated FUTURE month resolves nothing (critic F3) |
| "in fy2025" / "the 2025/26 season" | — (abstain) | — | date SHAPES no rule windows; must abstain, never the this-month default (critic F6) |

**The date-shape guard (`unresolvedDateShape`):** a question containing one of
these shapes that `parseExplicitTimeframe` could NOT window abstains every
timeframe-carrying route (spend family, income, largest, `intentFromKind`, the
conversation frame) instead of falling back to the silent this-month default.
Pre-2.7, "groceries in 2025" answered the unhedged THIS-MONTH Groceries figure
and "since 2024" the this-month total.

**The licence stays in lock-step:** `unconsumedSpendObject` consumes exactly the
tokens the parser can window ("in 2025" ✓, "on 3/5" ✓, "2024-2025" ✓) and never
the ones it can't ("in 2027" ✗, "on 13/5" ✗) — same recognizer functions, so the
guard reads what the parser reads.
