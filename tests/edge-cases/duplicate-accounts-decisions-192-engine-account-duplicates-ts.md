## §Duplicate-Accounts (DECISIONS #192 — `engine/account/duplicates.ts`)

Cross-provider duplicate detection is advisory. A pair is flagged only when the two accounts
are **different providers** (neither `demo`), **same `type`**, **same `currency`** (null = USD),
AND at least one signal fires. Confidence = `high` if last-4 or non-zero balance matches, else
`medium` (shared name token only). Hand-verified cases (mirrored in
`tests/unit/account-duplicates.test.ts`):

| A (provider, name, type, mask, bal¢, cur) | B (provider, name, type, mask, bal¢, cur) | Flagged? | Confidence | Reason |
|---|---|---|---|---|
| plaid, "Chase Total Checking", CHECKING, 1234, 50000, USD | simplefin, "CHASE Checking", CHECKING, —, 48000, USD | yes | medium | shared name: “chase” |
| plaid, "Savings", SAVINGS, 2222, 21000, USD | simplefin, "My Savings", SAVINGS, —, 21000, USD | yes | high | identical balance |
| plaid, "Chase", CHECKING, 1234, 50000, USD | manual, "Chase Bank", CHECKING, 1234, 30000, USD | yes | high | same last-4 (1234) · shared name |
| plaid, "Checking Account", CHECKING, —, 0, USD | simplefin, "My Bank", CHECKING, —, 0, USD | no | — | zero balance + no shared distinctive token |
| plaid, "Chase", CHECKING, —, 5000, USD | simplefin, "Chase", CREDIT, —, 5000, USD | no | — | different `type` |
| plaid, "Chase", CHECKING, —, 5000, USD | simplefin, "Chase", CHECKING, —, 5000, EUR | no | — | different `currency` |
| plaid, "Chase", CHECKING, 1234, 5000, USD | plaid, "Chase", CHECKING, 1234, 5000, USD | no | — | same provider (ingest already dedups) |
| demo, "Plaid Checking", CHECKING, 0000, 11000, USD | simplefin, "Plaid Checking", CHECKING, —, 11000, USD | no | — | `demo`/seed rows never compared (golden-safe) |

Name tokens: lowercased, non-alphanumeric split, then stopwords (bank/checking/savings/account/
credit/card/the/my/…), pure numbers, and 1-char tokens dropped. So "My Savings Account" and
"SimpleFIN Demo SimpleFIN Savings" both yield **no** distinctive tokens.
