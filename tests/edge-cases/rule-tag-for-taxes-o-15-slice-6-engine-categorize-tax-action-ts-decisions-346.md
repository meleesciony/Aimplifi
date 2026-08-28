## §Rule tag-for-taxes (O.15 slice 6 — `engine/categorize/tax-action.ts`, DECISIONS #346)

Hand-verified expectations locked by `tests/unit/rule-tax-action.test.ts`,
`tests/unit/keyword-rules-server.test.ts`, `tests/unit/backfill-tax-tag.test.ts`
and `tests/e2e/keyword-rules.spec.ts`.

### The stamp decision (`resolveRuleTaxStamp`) — abstentions are the majority

| rule's `setTaxClass` | row's current `taxClass` | result |
|---|---|---|
| `business` | null / undefined / `''` / `'   '` | **`business`** (the only writing case) |
| `business` | `medical` | **null** — never re-answer the reader |
| `business` | `business` | **null** — a no-op is not a write, so no count claims it |
| `business` | `crypto-losses` (unknown) | **null** — overwriting destroys the only record of his choice |
| null / `''` / `BUSINESS` / `not-a-class` | anything | **null** — the read-path gate |

### Which filings may carry a stamp

Typed rule that files → **stamps**. Learned rule carrying the same column →
**null**. Sign-refused rule (outflow into an Income category, so it never filed)
→ **null**. Merchant default, provider-category rescue, transfer, fallback →
**null**. This is what keeps every pre-slice filing byte-identical.

### The apply-to-existing sets, on the three `mirko` rows of the server suite

Base: 3 matched rows, target `dining`, tag `business`.

- All three untagged, none hand-filed, none excluded → `wouldTagCount` **3**,
  `alreadyTaggedCount` **0**, written **3**.
- One row pre-tagged `medical` → **2** tagged, **1** already-tagged, and that row
  still reads `medical` afterwards.
- All three ALREADY filed as `dining` → `affected` **0**, `taxTagged` **3**. This
  is the pair that proves the tag set is not the re-file set.
- Rule targets `income` (all three are outflows) → `signMismatchCount` **3**,
  `wouldTagCount` **0**, written **0**.
- One row hand-filed to `groceries` (a Correction, not in review) →
  `handFiledCount` **1**, `wouldTagCount` **2**, written **2**; the outlier keeps
  `groceries` and stays **untagged**.
- One row `excludeFromTotals: true` → `wouldTagCount` **2**, written **2**; the
  excluded row is still FILED as `dining` and stays **untagged**.
- No category chosen yet → `wouldTagCount` and `alreadyTaggedCount` are both
  **null**: the sign guard is part of the set, so any number shown before a
  category exists is one the save would reduce.

### The backfill (same decision, its own scope)

An unsure row the rule resolves → re-filed **and** tagged, `taxTagged` **1**.
Pre-tagged `medical` → re-filed, `taxTagged` **0**, tag untouched. Excluded row →
re-filed, `taxTagged` **0**. Split CHILD → `taxTagged` **0** (it carries its
parent's descriptor, so the keyword matches, and its amount is real money in the
export). Blank tag `''` → re-filed **and** tagged, because the two writers share
one definition of "untagged".
