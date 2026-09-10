# `bash` on this Windows box is WSL, not Git Bash — and the boundary eats env vars

One-line summary: On this machine `bash scripts/x.sh` spawns **WSL**, not Git Bash:
Windows node.exe resolves `bash` along a `;`-joined PATH, WSL interop then re-translates
each `;` entry to `/mnt/<drive>/...` preserving order, and **only `WSLENV`-listed
variables cross the boundary** — a test or script that colon-joins a Windows temp path
into PATH, or sets an env var for a bash child, silently does neither (both cost this
session real gate failures).

Details / why it mattered (session 2026-09-10, M.4 slice 2 / DECISIONS #724):

- `tests/unit/vercel-build.test.ts` stubs `node`/`npx`/`next` via a temp dir prepended
  to PATH with `:`. Linux CI resolves it; here the stub dir (`C:\Users\...\Temp\...`)
  never lands as a usable WSL path, so the REAL `npx`/`next` ran and the log file was
  never written (`ENOENT: ...\cmds.log`). Fix: on `win32`, prepend the stub dir in
  **Windows form** to a `;`-joined PATH (interop translates it first), and translate the
  stub's own log path to `/mnt/<drive>/...` because the stub executes inside WSL.
- The same test sets `DATABASE_URL` for the production branch. WSL forwarded nothing:
  `bash -c 'echo [$DATABASE_URL]'` printed `[]` from PowerShell with the var set.
  Fix: add the variable name to `WSLENV` (`env.WSLENV = 'DATABASE_URL'`) so interop
  carries it. Verify with a probe, not an assumption — `WSLENV` syntax is
  `VAR1:VAR2` for names and `/flag` suffixes for flags.
- Separately, a `core.autocrlf=true` re-smudge had rewritten 586 worktree files to
  CRLF on 2026-09-08, which broke `bash -n` on `scripts/vercel-build.sh`
  (`set: pipefail: invalid option name`) and overflowed a 4500-char source-window
  unit test (`coming-up-amount-cadence.test.ts`) because every line grew by one byte.
  The index blobs were all-LF throughout (`git ls-files --eol` → zero `i/crlf`), so the
  fix was a byte-level CRLF→LF rewrite of the worktree (content-identical) plus
  `.gitattributes` `* text=auto eol=lf` to pin future checkouts.

Rules of thumb:
1. Diagnose which bash you are in FIRST (`bash -c 'ls /mnt/c'` succeeds → WSL;
   `cygpath` exists → Git Bash). Their PATH/env semantics differ at exactly the
   places process-spawning tests care about.
2. Anything passed to a WSL bash child — PATH entries, env vars, file paths used
   *inside* the script — must be proven across the boundary with a probe
   (`bash -c 'echo [$VAR]'`), never assumed.
3. A `bash -n` "syntax error" naming an option that is plainly valid (`pipefail`) is a
   CRLF symptom, not a script defect.
