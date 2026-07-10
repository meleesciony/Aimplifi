# Lessons index

Cross-session memory. One line per lesson: `- [title](file.md) — one-line hook`.
Convention lives in `LOOP_ENGINEERING.md` → "Lessons ledger": one lesson per file, one-line summary at
the top, corrections and confirmed approaches alike with the *why*, no duplicates of what the repo or
ledgers already record, update rather than duplicate, delete lessons proven wrong.

- [Don't develop in cloud-synced folders](cloud-synced-folders.md) — OneDrive file locks cause spurious verify failures and CRLF churn; one-off cold-start failures that don't reproduce are environment flakes.
- [Generate code with Write/Edit, not shell heredocs](windows-codegen-via-shell.md) — bash→python heredocs mangled 
 escapes in generated TS and `*/` inside comments broke builds; file tools are byte-exact.
- [Diagnose hangs at boundaries, not by correlation](diagnose-hangs-at-boundaries.md) — load-correlated evidence pattern-matched the triage stall to the SQLite flake twice; paired client/server probes acquitted it in one run (React lane entanglement was the cause), and fixing the chronic failure unmasked two ordering bugs hidden behind it.
- [Mutation forms use onSubmit, never useActionState](mutation-form-recipe.md) — React 19's form-action auto-reset silently reverts uncontrolled `<select>`s to their first option on the error return → a silent mis-file; the proven recipe is onSubmit + own busy + withDeadline + reload/navigate on success. Bit #166 and again #170.
- [mobile-380 Playwright viewport-scaling flake](mobile-380-viewport-scaling-flake.md) — a ~11.8% viewport scaling mismatch could make fixed-bottom-nav clicks intercept. **CORRECTED #193:** the recurring "full e2e can't exit 0 here" was actually a DETERMINISTIC auth.spec strict-mode locator bug (#182's "Sign out of all devices"), not this flake, which did not reproduce across 3 full runs post-#187/PW-1.60; full e2e now exits 0. Read the error signature before blaming the flake — `intercepts pointer events` is it, anything else is a real bug.
