## §Balance-Move Explainer (AI plan §2.3 — `explainBalanceMove` / `validateTemplate` / `validateSentence`, DECISIONS #240)

A grounded one-liner over the tested trends movers. The LLM never authors a number: it returns a
TEMPLATE of ATOMIC placeholders ({primary}/{second} each substitute "Label, up $X (+Y%)" — a label
fused to its own figure) joined by purely ADDITIVE connectives; the engine substitutes. Reshaping is
hand-verified; the safety rails are what four fresh-context Fable critic cycles hardened.

### Reshaping (hand-verified, `balance-move.test.ts`)
Mover Dining current 84000 / baseline 60000 / delta +24000 / pct 0.4, direction up →
`formattedAbs "$240.00"`, `formattedSigned "+$240.00"`, `formattedPct "+40%"`, `deltaPhrase "up
$240.00"`, atomic `phrase "Dining, up $240.00 (+40%)"`. Gas delta −6000 / pct −0.2 →
`phrase "Gas, down $60.00 (-20%)"`. New factor (baseline 0) → no pct, `phrase "Travel, new at
$500.00"`. `primaryDriverId === movers[0].categoryId` ALWAYS (never a model choice). Pct is omitted
at the ±0 rounding edge (no "+0%"/negative-zero). Comparison window stated inline from the baseline
count: 3 months → "your 3-month average".

### The template grammar (`validateTemplate` — the model's only degrees of freedom)
Placeholders MUST appear in the exact order `{primary}` → optional `{second}` → `{window}` (window
required, last, no duplicates/reorder). Non-placeholder words must be in the purely-additive
`ALLOWED_CONNECTIVES`; a literal digit/$/% in the template is rejected. Rejections (each locked):

| template | reason | closes |
|---|---|---|
| `{second}, and {primary}, {window}.` | missing-primary | figure-swap-by-reorder (critic P0-1) |
| `{primary} {window} and {second}.` | placeholder-order | reorder / window-not-last |
| `{primary} and {primary} {window}.` | missing-window | duplicate placeholder |
| `The change was {primary}, with {second}.` | missing-window | window must be disclosed |
| `spending shifted from {primary} to {second} {window}.` | non-connective:shifted | false inter-category FLOW (critic P1-1) |
| `{primary} compared to {second} {window}.` | non-connective:compared | false comparison basis |
| `{primary} up $240.00 {window}.` | literal-number | model may not type a figure |
| `the new {primary} {window}.` | non-connective:new | ranking claim word |

### The final scan (`validateSentence` — runs on the substituted sentence AND the deterministic fallback)
Category labels are USER FREE TEXT, so the deterministic fallback is scanned too; on failure the
surface is SUPPRESSED (empty sentence, the movers list still carries the figures). Rejections:

| rendered sentence | reason | closes |
|---|---|---|
| `Dining moved up 240.00 vs your average.` | stray-number | bare numeral w/o $ (critic P0-1) |
| `Dining is up $240.00 compared with your 12-month average.` | stray-number | fabricated window |
| `Dining rose two hundred dollars…` / `…forty percent…` | banned:* | word-form numbers |
| `Dining is up ＄999.00…` | non-ascii | full-width/unicode currency |
| `Starbucks pushed Dining up $240.00…` / `…(Netflix)…` | proper-noun:* | invented merchant (pos-0 & parenthesized) |
| `Consider Dining…` / `…again.` / `…because of meals.` | banned:* | advice / habit / causal |
| `Dining rose $240.00 due  to meals.` | banned:due to | double-space phrase evasion |
| label "Because You Overspent" (top mover) | fallback-banned:because | hostile label via fallback (critic P1-3) |
| label "Save $500 Fund" (top mover) | fallback-stray-number | money-lookalike label |

Deliberately NOT suppressed (fail-open on the user's own real labels): a benign custom category
sharing a word with the sentence ("Spare Change" → the word "change"; no foreign-category scan —
the atomic grammar makes model category-injection impossible, critic P1-2), and a benign
digit-bearing finance label ("401k Contributions" — the factor's own label tokens are masked before
the stray-number check, critic P2-1). Demo is deterministic by CONSTRUCTION (never calls the LLM).
