# Lessons index

Cross-session memory. One line per lesson: `- [title](file.md) — one-line hook`.
Convention lives in `LOOP_ENGINEERING.md` → "Lessons ledger": one lesson per file, one-line summary at
the top, corrections and confirmed approaches alike with the *why*, no duplicates of what the repo or
ledgers already record, update rather than duplicate, delete lessons proven wrong.

- [Don't develop in cloud-synced folders](cloud-synced-folders.md) — OneDrive file locks cause spurious verify failures and CRLF churn; one-off cold-start failures that don't reproduce are environment flakes.
- [Generate code with Write/Edit, not shell heredocs](windows-codegen-via-shell.md) — bash→python heredocs mangled 
 escapes in generated TS and `*/` inside comments broke builds; file tools are byte-exact.
- [Diagnose hangs at boundaries, not by correlation](diagnose-hangs-at-boundaries.md) — load-correlated evidence pattern-matched the triage stall to the SQLite flake twice; paired client/server probes acquitted it in one run (React lane entanglement was the cause), and fixing the chronic failure unmasked two ordering bugs hidden behind it.
