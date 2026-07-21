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
