# A regenerator that cannot parse its input writes its own blindness out as the answer

One-line summary: `ledger.ts reindex` rebuilt the decisions index from a file it could only half
read and wrote 329 rows where 375 belonged — the fix that matters is not the better parser but
the refusal, because a derived artifact regenerated from a partially-understood source silently
publishes the shortfall as if it were the content.

## What happened

`docs/DECISIONS.md` carries two formats: the legacy `| n | phase | … |` table (#1–#337) and the
`## #n — title` sections every decision since #338 uses. The regenerator matched only the table.
Running it dropped all 46 heading-era decisions and reported success:
`DECISIONS_INDEX.md: regenerated (329 entries)`.

Three things made it worse than an ordinary bug:

1. **The generated file instructed the reader to run the destructive command.** Its own header
   said *"Do not hand-edit; run `tsx scripts/ledger.ts reindex` to regenerate."* A Cursor agent
   followed that in good faith during #384 and deleted #374–#382.
2. **The output looked like an answer.** A shorter index is not visibly a broken index. There is
   no error, no gap, no `undefined` — just fewer lines, in a file nobody reads end to end.
3. **STATUS documented it instead of fixing it**, for a day, as "do not run this" — which
   protects the humans who read STATUS and none of the agents who read the generated header.

## The rule

**A regenerator must fail on what it cannot parse, not skip it.** Where the output is derived
and overwrites its predecessor, the parser's blind spot becomes deletion. Concretely, the guard
that shipped: before writing, diff the identifiers you are about to emit against the identifiers
the existing artifact already carries; if any would disappear, throw, name every one, and write
nothing.

That guard is worth more than the parser fix beside it. The parser handles the format I know
about; the guard handles the *next* format, which is the one that will actually bite — the same
"by construction, not per call site" move as `fence-by-construction-not-per-call-site.md`, applied
to generated files. It is also LOOP_ENGINEERING rule 6 (fail loudly or not at all) in the one
place it is easiest to forget, because nothing crashed.

**Prove the guard by mutation, not by argument.** Revert the parser to its blind state and run the
real command: it must refuse, name what it would have dropped, exit non-zero, and leave the file
byte-identical. A guard nobody has watched fire is a hypothesis.

## The same disease, twice in one session

Writing that session's PROGRESS entry through `tsx scripts/ledger.ts progress "<title>" "<body>"`
kept **the first line** of a 70-line body and printed success. Different mechanism entirely — the
truncation is at the Windows process/argv boundary, reproducible with
`npx tsx -e 'console.log(JSON.stringify(process.argv[1]))' "$(printf 'a\nb\n')"` → `"a"` — and
the identical shape: a ledger tool wrote less than it was given and said it had written it.

So the family test, whenever a script writes a file for you: **can this thing produce a smaller
output than its input warrants, and would that look exactly like a correct run?** If yes, it needs
a floor it refuses to write below, not a comment telling the next reader to be careful.

## Corollaries

- **Measure the claim before fixing it.** STATUS said 34 decisions were missing; a five-line probe
  confirmed exactly 34, with no duplicates and no orphans, before a line of code moved. The fix
  was then provably complete rather than probably complete.
- **Fix the sibling the same read surfaces.** `nextDecisionNumber` was blind in the identical way
  and would have returned 338 — a number in use since 2026-07-31 — appending a duplicate under it.
  One root cause, two consumers; grep for the others while you have the file open.
- **Name the deliberate losses.** Regenerating replaced hand-written index summaries for #374–#385
  with the headings' own titles. Nothing left the source file, and the index has one author again
  instead of two — but that is a decision to record, not a diff to hope nobody notices.
- **A "do not run this" note in STATUS is a workaround, not a remedy** — the class in
  `prevention-is-not-a-remedy.md`. It cannot reach the agent reading the generated header.
