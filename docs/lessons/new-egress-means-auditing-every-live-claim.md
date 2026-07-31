# A new egress path invalidates claims written for the old ones — audit every live "never" in the same slice

**One-line:** #247 shipped a structurally-sound extractor whose 4 critic P1s were all CLAIMS, not
code: the privacy policy still said balances are never sent, the UI promised a stronger scrubber
than the regex, a comment claimed "every printed form" of negative abstains, and the "every request
path is rate-limited" rule silently didn't cover the new path.

When a slice adds a new way data leaves the machine (or a new LLM touchpoint), the code review is
the easy half. In the same slice, before the critic:

1. **Grep every live never/only claim** — `never sent`, `never leaves`, `only .* is sent`,
   `is never`, `removed`, `always` — across the privacy policy, in-product disclosures
   (ask-view, trust page, learned-phrases), and code comments/test titles. Each one was written
   when the old egress set was the whole truth; the new path can falsify any of them without
   touching their files. (#243 claim-breadth was the same disease for fences; this is the egress
   instance.)
2. **Claims must be exactly as strong as the code.** A best-effort mechanism (the digit-run
   scrubber) may not be described categorically ("numbers are removed") — name the residual in the
   same sentence, and record it in EDGE_CASES. Conversely, a test titled "every printed form" is
   itself a claim — rename it to the enumerated truth or make it true.
3. **Sweep the cross-cutting per-request rules** (rate limit, audit sink, demo fence,
   requireUserId ordering) as a checklist for the NEW path — each existed as a repo-wide "every
   path does X" invariant that nothing enforces on paths that didn't exist when it was written.

Why it mattered: all four P1s had one-file fixes, but any of them shipped would have been a false
live money/privacy statement — the #221/#243 class the repo treats as P1 regardless of how correct
the underlying code is.

## Extended O.15 slice 6 — a new WRITER of a column invalidates the carve-outs written about it

The same disease one level in, and it cost the sharpest finding of that slice's critic cycle.
`engine/transactions/exclude.ts` carried a deliberate, well-argued carve-out: the tax export
still counts a row the reader both TAGGED and EXCLUDED, because "a row given two orders" should
not lose the deduction silently. Correct — and true only while the ONLY way to get a `taxClass`
was the reader typing it on that row.

The slice made a RULE a second writer of that column. The reader had then given exactly one
order ("this is not my spending") and the rule supplied the other, so money he had removed from
every other total would have landed in a figure bound for a tax preparer. Nothing in the diff
touched `exclude.ts`; the carve-out simply stopped being about the situation it described.

**The rule:** when you add a writer to a column, grep for every documented DECISION about that
column — not just claims about what the app says, but carve-outs, exemptions and "we
deliberately allow X because Y" comments — and re-read each one asking *is Y still true with
this new writer?* A carve-out is an argument with a premise, and a premise about who writes a
value dies the moment someone else can write it.

Corollary from the same cycle: when a slice adds a THEN-action to machinery that already
enumerates its actions in user-facing copy ("transactions it already filed keep the category and
the payee name"), those enumerations are claims with the same failure mode — both rule-list
footers in this app still listed two of three actions after the third shipped. And a code comment
asserting "the residual is recorded in docs/STATUS.md" must not be written before the record
exists: the critic grepped for it, correctly, and it was not there.

