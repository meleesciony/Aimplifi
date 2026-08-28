## §Giving goal preset (Goals — COACH_PRINCIPLES_PLAN C14)

A preset on `/goals` is a **name**, never an amount. The reader types
the dollars; `createGoal` stays the ordinary savings write path
(`kind` null). No 10% of income, no tithe band, no Coast-FI gate
(that framing stays on the FI card). Engine:
`src/lib/engine/goals/presets.ts`. College/education is a sibling
plan item, shipped as §Education goal preset below.

| # | Inputs | Expected |
|---|--------|----------|
| GP1 | id `giving` | `{ name: 'Giving' }` — keys are `name` only |
| GP2 | unknown id | `null` — does not invent a name |
| GP3 | identity | `GIVING_GOAL_PRESET.name === 'Giving'`; label copy is that same string |

---
