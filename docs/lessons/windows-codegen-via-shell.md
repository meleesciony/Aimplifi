# Generate code with Write/Edit tools, not bash-heredoc→python, on this Windows box

One-line summary: On this machine, generating TypeScript through `bash heredoc → python
string → file` mangled `\n` escapes into literal newlines inside string literals (broke
the build twice, cost several repair calls); the Write/Edit file tools are byte-exact —
use them for any generated code, and keep shell pipelines for running things, not
writing them.

Details / why it mattered (session 2026-07-04, #163):
- A python heredoc writing `rows.join('\n')` produced a real newline inside the TS
  string literal → esbuild "Unterminated string literal". Repairing via `perl -0pi`
  failed too (git-bash quoting on Windows). The Edit tool fixed it first try.
- Same session, twice: a TS block comment containing `TST*/` closed the comment early
  ("TST*" is a payment-processor prefix that ends in `*`, followed by `/Toast`).
  When writing comments that mention `X*/Y` patterns, rephrase (`TST* (Toast)`).

Rule of thumb: shell for execution and search; Write/Edit for file contents —
especially anything containing backslashes, quotes, or `*/`.

**Corrected/extended 2026-07-29 (O.12d, DECISIONS #337): "byte-exact" was overclaimed —
an Edit produced a raw NUL (0x00) where a space was intended,** inside a plaid.ts template
literal. tsc/eslint/vitest/next-build all passed over it (verify went GREEN), but ripgrep
classified the file as BINARY and every recursive grep sweep silently truncated at the byte —
right at the new write path — so the repo's grep-based audit discipline went blind exactly
where it was needed. Both fresh-context critics found it independently by byte-level probe.
The same session's ledger-append heredoc ALSO carried a control byte (the Bash tool's
validation caught that one). Standing gate now: `tests/unit/source-hygiene.test.ts` scans
src/tests/scripts for any control byte besides tab/LF/CR (fail-old proven; its first clean
run caught a pre-existing raw-0x01 pair in `server/coach.ts` — when a joiner needs a
non-printable separator, write the six-character escape `backslash-u0001`, never the raw byte).
After editing generated code, a `python -c "...count control bytes..."` spot-check is
cheap; the unit gate is the backstop. CRLF is the sibling failure: a whole-file
line-ending flip (4,513-line diff for a 161-line change) poisons blame/bisect — check
`git diff --stat` vs `git diff -w --stat` before committing a big file.
