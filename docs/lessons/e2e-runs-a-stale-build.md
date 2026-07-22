# An e2e spec run tests the last `next build`, not your edit

`playwright.config.ts` starts the app with `npx next start -p 3100` and, locally,
`reuseExistingServer: !process.env.CI` is **true**. Both halves of that mean the
same thing: a targeted `npx playwright test tests/e2e/<spec>.ts` after a source
edit runs against **compiled output from an earlier build** (or against a server
already squatting on 3100), so the change under test is simply not there.

This burned a full diagnostic detour in #261. A new assertion failed, and the
failure was indistinguishable from a real defect — the assertion read the OLD
behaviour, exactly as if the fix had not worked. Two probe runs were spent
instrumenting the component to prove a `useEffect` "never ran" before the actual
cause surfaced: `next start` was serving the previous build. After one
`npx next build`, the same probe printed the expected values on the first try.

**The rule:** after editing anything under `src/`, run `npx next build` before any
targeted Playwright invocation. `bash scripts/verify.sh` already builds, so the
full gate never has this problem — it is only the fast targeted loop that does,
which is precisely the loop used while iterating on a fix.

**The tell:** the failure looks like "my change had no effect at all" rather than
"my change had the wrong effect". A `useEffect` that appears not to fire, a new
`data-testid` that is missing, a new prop that reads as `undefined` — none of
those are usually real. Rebuild first, then believe the failure.

Related: the same config comment warns that a stale server on 3100 also resolves
the `.env` default `file:./dev.db` instead of the relocated e2e database, so a
reused server can silently test the wrong data as well as the wrong code.
