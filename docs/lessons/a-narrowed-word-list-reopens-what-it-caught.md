# A narrowed word list reopens what it used to catch — test both directions of a vocabulary

**One line.** #788's return rule was widened in cycle 3 (a return-worded row cancels a deposit), narrowed in cycle 4 (bare "REV"/"RETURN" are other money — revocable trusts, tax refunds, store returns), and that narrowing silently reopened cycle 3's own P1 for every bank wording outside the new list ("NSF RETURN", "ACH RTN", "UNPAID ITEM") — found only by cycle 5.

**What happened.** Each cycle fixed the direction its critic attacked. Cycle 3's critic attacked *misses* (a bounced deposit still counted); the fix widened the vocabulary. Cycle 4's critic attacked *false hits* (unrelated money cancelled real deposits); the fix narrowed it to phrases. The cycle-4 tests locked the false hits it closed and kept cycle 3's locks green — but cycle 3's locks only held the five wordings that critic had executed, so every wording between "bare REV" and those five fell out unseen. 77 mutations were killed; none of them was "a real bank wording we never listed".

**Rule.** A word list that decides money has two failure directions, and a fix that moves the boundary must be tested on both sides of the NEW boundary:
- keep a corpus of positives (what must match) and negatives (what must not) in one test, and add to both whenever either direction is fixed;
- when narrowing, list the realistic members the old wide rule caught and decide each one explicitly — a narrowing that drops a class without naming it is a regression with a green suite;
- a mutation run proves the code is tested, not that the vocabulary is complete.

**Related.** [A typed key is a PATTERN](a-typed-key-is-a-pattern-not-an-identity.md); [A fix that cannot fail a test is a hypothesis](a-fix-that-cannot-fail-a-test-is-a-hypothesis.md); [Money taken back is found by what it is](money-taken-back-is-found-by-what-it-is-not-whose-name-it-carries.md).
