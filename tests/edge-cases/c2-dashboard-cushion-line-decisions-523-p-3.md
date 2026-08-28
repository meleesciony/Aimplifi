## C2 dashboard cushion line (DECISIONS #523, P.3)

The radar dip gets one pairing sentence — `COACH_COPY.cushionLine(months)` via
the pure `cushionLineFor(status, firstNegativeDate, runwayMonths)` — and the
sentence is pinned byte-identical in `tests/unit/radar-cushion-line.test.ts`
with the hand-written expected values below ("what no forecast sees" is the
plan's own wording; the months count is `coach.runwayMonths`, the same value
the room-for-error pill prints — one value, one author, never rounded):

| # | Inputs | Expected |
|---|--------|----------|
| CL1 | `('alert', '2026-06-24', 2.1)` | `Surprises are what history guarantees — and your 2.1-month cushion is what handles what no forecast sees.` |
| CL2 | `('alert', '2026-06-24', 1)` | `…your 1-month cushion…` — singular form |
| CL3 | `('ok'\|'watch', null, 2.1)`, `('alert', null, 2.1)` | `null` — no dip printed, no line |
| CL4 | `('alert', '2026-06-24', Infinity)` | `null` — ∞ is "no expenses yet" (monthsOfRunway contract), not a month count |
| CL5 | `('alert', '2026-06-24', 0 \| -2.3 \| null)` | `null` — a zero/negative/absent cushion is an absence to disclose elsewhere (the pill's own honest sentences), never a "cushion handles it" claim |
| CL6 | regression lock | the line never names the dip date/amount and never claims to cover the shown dip (`this dip`, `handles it`, `covers it` forbidden — the cover transfer above does that) |
