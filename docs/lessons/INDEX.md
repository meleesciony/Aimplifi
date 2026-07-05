# Lessons index

Cross-session memory. One line per lesson: `- [title](file.md) — one-line hook`.
Convention lives in `LOOP_ENGINEERING.md` → "Lessons ledger": one lesson per file, one-line summary at
the top, corrections and confirmed approaches alike with the *why*, no duplicates of what the repo or
ledgers already record, update rather than duplicate, delete lessons proven wrong.

- [Don't develop in cloud-synced folders](cloud-synced-folders.md) — OneDrive file locks cause spurious verify failures and CRLF churn; one-off cold-start failures that don't reproduce are environment flakes.
- [Generate code with Write/Edit, not shell heredocs](windows-codegen-via-shell.md) — bash→python heredocs mangled 
 escapes in generated TS and `*/` inside comments broke builds; file tools are byte-exact.
