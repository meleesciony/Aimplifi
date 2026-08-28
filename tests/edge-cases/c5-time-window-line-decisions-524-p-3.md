## C5 time-window line (DECISIONS #524, P.3)

The C5 row's last gap — "buy experiences while you can" — closes as one
sentence on the life-energy card via the pure `windowLineFor(itemCount)` →
`COACH_COPY.experiencesWindow()` (pinned byte-identical in
`tests/unit/experiences-window.test.ts`):

| # | Inputs | Expected |
|---|--------|----------|
| EW1 | `windowLineFor(5)` | the sentence — a card with purchases qualifies the framing |
| EW2 | `windowLineFor(0)` | `null` — "No large purchases in the last 90 days" already stands there; a "savor the moment" line over it would qualify nothing (same absence rule as CL4/CL5) |
| EW3 | regression lock | no numeral, no reader age/health claim (none stored, #518), no imperative to spend, no Aimplifi read-path claim, no restatement of the Coast-gated #503 sentence |
| EW4 | regression lock | `moneyDials` and `lifeEnergyReflection` byte-identical — both are read by the production probe and by the Ask `what_to_cut` answer; the slice adds one leaf, never edits one |
