## §Employer-match Settings (W.6(b) follow-up — DECISIONS #528)

Match is a **rung**, not a percentage compared to APR. The Settings card stores a
closed status; `parseEmployerMatch` is the one boundary. Fail-safe is **skip**
(`unknown`) — a missing or garbage column must never rank as "capture the match."

| # | Input | Result |
|---|--------|--------|
| EM1 | `''` / `'unknown'` / null / whitespace | `unknown` |
| EM2 | `'uncaptured'` / `'captured'` / `'none'` (trimmed) | same token |
| EM3 | `'yes'` / `'50'` / `'UNCAPTURED'` / `'true'` | `unknown` (never invent uncaptured) |

Column: null stores `unknown`. Demo writes are fenced. Tax-advantaged room is still
uncollected.
