## §Education goal preset (Goals — COACH_PRINCIPLES_PLAN C14)

The sibling of §Giving goal preset and the last C14 leftover. Same
contract: a preset is a **name**, never an amount, and `createGoal`
stays the ordinary savings write path (`kind` null). The name is the
taxonomy's own leaf label — `CATEGORY_BY_ID.get('education').name` —
so the chip label and the submitted `Goal.name` have one author.

What this preset deliberately does **not** do:

* **It does not claim a `/reports` lens.** Giving has one (`givingYtd`,
  #520); education spend has none, so this hint may not borrow
  Giving's "a lens, not a grade" clause. Copy that describes a surface
  the app does not render is a fabrication (rule 1).
* **It names no account and no tax treatment** — no 529, no ESA, no
  scholarship. The app has no account-recommendation surface and no
  state-by-state facts to stand on.
* **It does not rank education against retirement.** The canon
  disagrees with itself here; a preset is a name the reader asked for
  by clicking, not an ordering the app performed.
* **A student loan is a debt, not this envelope.** `student-loan` is a
  taxonomy leaf the debt planner already owns, so the hint says so —
  otherwise a reader files a payoff as savings and both surfaces lie.

| # | Inputs | Expected |
|---|--------|----------|
| EP1 | id `education` | `{ name: 'Education' }` — keys are `name` only |
| EP2 | ids `college`, `529`, `tuition`, `student-loan`, `` | `null` — the id is `education`; nothing else invents a name |
| EP3 | identity | `EDUCATION_GOAL_PRESET.name === CATEGORY_BY_ID.get('education')?.name`; label copy is that same string |
| EP4 | registry | ids unique; order stable `['giving','education']`; every preset's fields are exactly `['name']` |
| EP5 | growth | adding a preset leaves `goalPresetFields('giving')` and every string the #521 live probe greps byte-identical |
| EP6 | rendered label | each chip's own text equals its preset name — the fill is read from the registry, so only the chip's text catches copy wired to the wrong preset (e2e + live probe) |
