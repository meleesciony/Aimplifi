# An empty set is not a fact about money

**One-line summary:** when an engine drops a row it cannot compute, every surface downstream
renders the resulting emptiness as a positive claim — "nothing is due", "you're all caught up",
"no credit cards yet" — so a filter that discards the unknown must carry it out instead, and the
fix has to reach every consumer of the now-incomplete set, not just the one that got reported.

## What happened (#277)

The owner linked real credit cards through Plaid and the dashboard said **"No card payments are
due this cycle."** while the cards carried balances. `/cards` said **"No credit cards yet. Connect
the bank that issues your card"** — to someone who had just connected it.

The engine was not confused. `buildObligation` returns null for a card with no statement and no
cycle days, and its comment says exactly what it means: *"nothing knowable about this card."* The
bug was one line up: the caller wrote `if (ob) allObligations.push(ob)` and dropped the null on the
floor. From that point on, "we could not date this card" and "this card is paid off" were the same
value — the absence of a row — and eight surfaces turned it into a sentence about the user's money.

## The rules

- **A filter that discards an unknown must return it, not swallow it.** If an engine can tell that
  it cannot compute something, that knowledge is a result. Dropping it converts "unknown" into
  "zero" at the first consumer and there is no way to recover it later.
- **Ask what the empty case renders as.** Every `length === 0` branch in a money UI is a claim.
  Before shipping one, say it aloud with the unknown case in mind: "no reminders" → *you're all
  caught up*; "no obligations" → *nothing is due*; "no cards" → *you have no cards*. If any of
  those could be false while the set is empty, the set is the wrong thing to branch on.
- **Fix the data class, not the reported surface.** The first pass here fixed the two surfaces the
  owner named. A fresh-context critic found the identical false claim still standing on six others
  — the assistant, the weekly digest email, the reminders card, the nudge feed, the radar
  assumption text, and a coach line promising "every card clears in full". This is the #221 lesson
  again: grep every consumer of the widened/narrowed data class in the same slice.
- **The email is the worst surface to get wrong.** In-app you can put a correcting panel next to
  the claim. In an email there is nothing to correct it, and the mixed case (something *is* due,
  plus something undatable) is more likely than the all-empty case that's easier to remember.
- **A fabricated figure is worse than an honest gap.** Trying to rescue the undatable cards, this
  session relaxed the estimate path to date a card from its due day alone. The critic executed it:
  a card due on the 25th with no cycle anchor was dated *the next day*, generating an $842.67
  shortfall and a live "move $850 into checking today" instruction — and the guessed date was
  disclosed to the user as the issuer's own. Reverted, and counter-locked with a test. Check a
  rescue's failure DIRECTION, exactly as the merchant-DB lesson says.
- **Don't write an instruction without opening the screen it names.** Two rounds of copy told the
  user to add a statement — first on a "card settings" screen that doesn't exist, then on Accounts,
  where the button exists **only for manually-added cards**. No wording makes a missing control
  followable; the honest version says what the app will do (re-check daily) and asks nothing.

## The second half: a write path with one caller and no schedule

The reason the cards had no statements is worth its own note. `syncLiabilities` — the only writer
of card due dates, statement balances and minimum payments — had exactly **one** production caller:
the link action, inside a `try/catch` that swallowed the error. No cron called it. So the data
behind the app's central question was fetched once, best-effort, at link time, and never again.

Two checks that would have caught it, cheap enough to run on any ingest path:

1. `grep` for every caller of the function that writes a field the product depends on. One caller,
   inside a swallowing catch, is a finding on its own.
2. Ask what refreshes it *tomorrow*. A value that is only ever written during a one-time setup flow
   is stale by design — and a catch block that comments "expected: the item may not be ready yet"
   is describing a retry that has to exist somewhere.
