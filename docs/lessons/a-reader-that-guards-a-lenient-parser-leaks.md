# A reader that guards a lenient parser leaks — consume every word or refuse

**One-line summary:** #796 spent three critic cycles adding guards around `parseExplicitTimeframe`
(which keeps the first window it recognises and silently drops the rest); every cycle found a new
phrase it dropped. What held was a closed grammar that consumes whole period phrases and refuses any
time word it did not consume — plus one positive word licence on every path.

## What happened

The owner's question — "what was my effective saving rate over last year" — reached a route that
dropped "last year" and answered one month. The first fix read the period with the app's general
timeframe parser and then guarded what that parser could not represent:

- cycle 1: qualifier words ("the first half of 2025", "before 2025", "excluding 2025") were read as
  the bare year; "may and june" as June; a savings phrasing with an unreadable tail fell through to
  the spend and income routes;
- cycle 2: two periods in one question ("in 2025 and so far this year", "march of last year",
  "this month last year") were read as one; "last may" read as no period; the LLM path skipped the
  licence the parser applied;
- cycle 3: "march to now" read as March; the LLM fallback had no word licence at all.

Each guard was a blocklist of what the lenient parser might have dropped. The parser's contract —
"find a window somewhere in this text" — guarantees there is always another way to put a word it
ignores beside the one it reads.

## The rule

- **When a component must answer exactly what was asked, read with a grammar that CONSUMES, never
  one that SEARCHES.** Recognise whole phrases from a closed list, remove what you recognised, and
  treat any leftover word of the same kind (time, here) as a refusal. "A word I did not consume is a
  refusal" cannot be bypassed by a new adjacent word; a blocklist can.
- **One licence, every path.** The parser, the follow-up frame and the LLM/learned-phrase fallback
  must call the same reader AND the same positive word licence. A model is allowed to pick a route,
  never the subject: "my bonus", "my wife", "rent" are not licensed words, so they abstain.
- **Fail-closed has a cost; measure it.** Each cycle's critic also listed phrasings that now
  abstained. Abstaining shows the capabilities list — honest, but the owner's complaint was that
  basic questions aren't answered. Re-run a list of everyday phrasings every cycle, not only the
  adversarial ones.
- **Normalisation is part of the grammar.** Cycle 4's one P1 came from the grammar's own
  pre-processing: stripping possessives so "last year's" would read turned "the 2020's" into the
  year 2020. Every rewrite of the input before the grammar sees it needs the same "refuse, don't
  guess" test as the grammar itself — a decade, an apostrophe year ('25), a plural.
- **A copy change is a test change.** Cycle 2 reworded the basis sentence; the e2e spec still
  asserted the old words and gate 3 failed on it. Grep `tests/e2e` and `scripts/*-live-*` for any
  sentence you reword, in the same commit.
