# A precision fix that fabricates $0 is worse than a safe category-superset

**One-line:** Before "improving" a wrong-but-safe answer, check the failure DIRECTION of the fix —
converting a nonzero superset answer into a confident $0 for money the user actually has is the
cardinal sin, even when the fix is "more precise" on the cases it gets right (TASKS 2.8, #231).

## What happened
STATUS §OPEN item 2: a category synonym inside a store name ("at travel lodge" → the Travel group,
"at 24 hour fitness" → fitness) answered the whole CATEGORY instead of the store. This looks like a
bug worth fixing — but the category is a **superset** of the store, so the answer was a nonzero,
wrong-SCOPE figure, never a $0. The fix routed these to `merchant_spend` by detecting a "distinctive"
store token beside the synonym. It took three fresh-context Fable critic cycles to learn it was the
wrong trade:

- **The approach is unsound at the root.** "SHELL gas station" (a brand) and "FANCY gas station" (an
  adjective) are the identical shape `[X][synonym][place-tail]`. No lexicon and no structural rule
  separates a brand token from a generic modifier — that IS the merchant-identification problem, which
  needs a merchant database the app does not have. Cycle 3's decisive line: "enumerating adjectives
  can't win this." Every cycle patched the sampled leaks (tail-scan, then modifiers, then plurals) and
  the *same* disease re-entered through the next unenumerated word.
- **The fix's failure direction was worse than the bug's.** To win rarer store questions it REGRESSED
  common, currently-correct category questions ("at gas stations", "at the fancy coffee shop") into
  confident $0 fabrications ("No spending at Gas Stations"). A confident $0 for spending that exists is
  the cardinal sin; the pre-existing superset answer never was.

## The rule
1. **Classify the failure you're fixing by direction, not by "wrongness".** A wrong-SCOPE nonzero
   superset (category ⊇ store) is directionally-correct and self-limiting; a fabricated $0 is a
   confident false negative. Only ship a fix whose worst new output is no worse than the old worst
   output. "More precise on the happy path" does not offset "fabricates on common input."
2. **When separating two classes needs data you don't have, the honest deliverable is the FINDING,
   not the code.** Some parser ambiguities (brand vs. adjective, store vs. category) are the
   merchant-identification problem in disguise; they are closable only with a merchant database.
   Record that, fold the item into the existing merchant-DB-blocked class (item 3), and surface the
   scope decision — don't ship an enumeration that leaks the cardinal sin through the next word.
3. **The 4-cycle cap is a detector for exactly this.** If each critic cycle closes the sampled repros
   and the next cycle finds the same disease on new samples, the approach — not the samples — is the
   problem. Stop before the cap and name the structural blocker rather than patching a fourth filter.
4. **A narrow SOUND subset can still be worth it later.** Un-ambiguous signals (a possessive
   "gold's gym", a digit-bearing "24 hour fitness") separate brands from adjectives with zero $0 risk.
   If the narrow win is worth a slice, take only that — never the ambiguous majority.

## See also
- `docs/lessons/a-guard-must-read-what-it-guards.md` — the cycle-1/2 holes were this lesson again
  (the guard scanned different input than the router until it was anchored to `extractSpendMerchant`).
- `docs/lessons/context-carrying-features-must-abstain.md` — abstain / keep-the-safe-answer beats
  answering a question you can't represent.
- DECISIONS #231; STATUS §OPEN items 2–3.
