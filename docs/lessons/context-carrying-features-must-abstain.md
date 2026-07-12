# A feature that carries context must be judged by what it ABSTAINS on, not what it resolves

One-line hook: the Ask conversation frame's 29 happy-path tests all passed and the engine was
still wrong three ways — every bug was a fragment it *shouldn't* have resolved, and the only
tests that could have caught them are the ones that assert `null`.

## What happened (#222/#223, TASKS 2.1)

The conversation frame lets a follow-up fragment ("what about last month?") re-run the previous
question with one slot swapped. It was built engine-first, pure, deterministic, reusing the
parser's own helpers so it could not re-implement (and therefore contradict) the router's
vocabulary. Verify was green: 2429 unit tests, e2e driving the real UI through two chained
ellipses. It looked done.

A fresh-context Fable hostile critic found three P1s in one pass. All three were the same shape:

1. **"and this month at costco?"** — the merchant sat *behind* the timeframe, so the merchant
   tokenizer (which only looked at the fragment's start) found nothing, and the code fell through
   to a timeframe-only swap that carried the OLD category. The user named Costco and got a
   confident groceries figure.
2. **"restaurants not groceries"** — negation was never modelled, and the synonym table is
   first-match-wins with groceries before dining. The answer was a confident figure for the
   category the user had just rejected.
3. **"what about income?"** — any short noun that wasn't a category became a *merchant* probe:
   "No spending at Income this month." It also silently stole the question from the LLM
   classifier, which routes `income` correctly.

None of the 29 tests failed, because every one of them asked "does the right fragment resolve
correctly?" — and they all did.

## The lesson

**For any feature that resolves an under-specified input against remembered context — an
ellipsis resolver, a "did you mean", a default-filling wizard, an inferred filter — the resolution
cases are the easy half. The interesting half is the abstention set, and it is not discoverable
by testing the feature's own happy path.** The failure mode is never "it didn't answer"; it is
"it answered something adjacent, confidently, and the user cannot see which question it actually
answered." On a money surface that is the whole ballgame.

Practical rules that came out of it:

- **Write the abstention tests first, and make them the majority.** A context-carrying resolver's
  test file should be visibly lopsided toward `expect(...).toBeNull()`. If it isn't, the feature
  hasn't been thought through.
- **Enumerate the input classes the feature cannot represent, and abstain on each explicitly.**
  Ours were: negation/exclusion, comparison, causation ("why"), advice ("should I"), and the
  assistant's own intent vocabulary. Each got a guard whose only job is to bail out. Every guard
  fails SAFE: a false hit degrades to the honest `unknown` (and the LLM rescue still runs), which
  is always cheaper than a wrong answer.
- **Order-dependence is a bug class of its own.** "at costco last month" worked; "last month at
  costco" silently dropped the merchant. Whenever extraction is positional, test both orders.
- **A carried slot can rot.** "This month" is deictic: the window it named in June is a lie in
  July. Anything carried across time must be re-derived or re-labelled against *now*, not echoed
  verbatim.
- **A value that starts server-side and becomes client-echoed has silently become untrusted
  input.** Our `AssistantIntent` had lived only in the server; the moment the client handed it
  back, `validateIntent` became a trust boundary — and it turned out to accept month `2026-13`, an
  unbounded label, and a 100,000-char merchant, all of which would have flowed straight into an
  answer's headline. When a field crosses a new boundary, re-read its validator as if it were new.

## The meta-lesson

The critic was worth more than the builder's own second pass would have been, precisely because it
did not know which fragments the builder had in mind. It went looking for the questions a user
would type that the design had never considered — which is exactly the set that a self-review,
anchored on the design, cannot see.
