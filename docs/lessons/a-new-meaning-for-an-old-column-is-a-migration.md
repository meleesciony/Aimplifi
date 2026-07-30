# Giving an existing column a new meaning is a data migration — and "lossless by construction" answers the wrong question

O.13c added OR-groups to the typed keyword rules by encoding them into the column that already
held the keywords: groups joined with `|`, and `|` added to the parser's separator set so no token
could ever contain it. Every docblock said the codec was **lossless BY CONSTRUCTION**, and every
docblock was right — about values the new codec wrote itself. That is not the property that
mattered. The column already had rows in it, written by a **different parser**, and under that
parser `|` was an ordinary character *inside* a keyword.

So the change silently redefined data already in the database:

- `amzn mktp us|y47` was one AND key requiring the literal text `us|y47`. It became an OR that
  fires on `y47` **alone** — at 9900 bps, `needsReview: false`, no badge, no review.
- `shell|a` passed O.13a's 3-character floor as a single 7-character token. It would have decoded
  to the group `["a"]`, which matches nearly every descriptor and mass-files an entire account
  into one category.

Nothing in the diff was wrong as *code*. The defect was entirely in the relationship between new
code and old bytes, which is the one thing a unit test written alongside the new code will not
see.

## What to do instead

**A new encoding gets a new column.** `matchKeywordGroups` is additive and nullable, written only
by the new codec, authoritative when present. The old column keeps the meaning it has always had,
read by a decoder that keeps the **old separators forever**. `prisma db push` stays additive; no
data moves; no stored byte changes meaning. Reaching for the existing column saved one migration
and bought a silent mass mis-file.

**Make the degradation direction explicit.** A multi-group rule also writes its first group into
the old column, so if the new column were ever lost the rule narrows to one group rather than
widening. When you cannot rule a failure out, at least choose which way it falls.

**Re-assert data-integrity invariants on the READ path.** The length floor lived only in
`assertUsableKey`, on the write path, so it could not protect a row that reached the column any
other way — including a row that had *changed meaning underneath it*. A guard that runs only at
creation is advisory. `server/rules.ts` was already re-applying `isAggregateCanonical` at load
time with the comment *"defense in depth … even if a rule row predates the creation-time guard"* —
the identical argument, one function away, not applied. Put the floor in the single basis every
reader decodes through, so the rules page can never render a key the engine does not execute.

## The test that hid it

A test titled *"every pre-O.13c key decodes as before"* asserted on `'tjmaxx 0181'` — a key with
no `|`, which is a **tautology under both codecs**. The only interesting legacy input is one
containing the character whose meaning changed. When you change how stored data is interpreted,
the fixture must be a value the OLD writer could have produced and the NEW reader would read
differently; anything else is theatre. Ask of every lock: *what value would make this fail?*

## Corollaries

- **Verify, don't reason, about production data.** The honest answer to "does any stored row
  contain a `|`?" was *I cannot see the production database from here* — no `DATABASE_URL` for
  Neon locally, only `file:./dev.db`. "It shipped yesterday, there probably aren't any" is not a
  verification, and the fix that makes the question moot is cheaper than the one that needs the
  answer.
- **Judge probability and consequence separately.** A low-probability path whose consequence is
  "silently auto-files the reader's entire history into one category" outranks a likely cosmetic
  bug. Ranking on consequence is what made this a P0 rather than a documented residual.
- **Two independent critics converging is the strongest signal you get.** Both fresh-context
  critics found this one, from different assigned lenses (parser/migration and money-adjacent
  writes). Each also found P1s the other missed — the parallel pass earns its cost in the
  non-overlap.
- **A confident comment is not evidence.** Three docblocks and the schema comment asserted "a
  pre-O.13c row has no `|`". The assertion was simply false, and it had been written by the same
  pass that introduced the defect, so it read as authority when it was actually the bug's own
  reasoning. Check the claim, especially when it is stated in capitals.
