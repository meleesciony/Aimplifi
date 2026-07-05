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
