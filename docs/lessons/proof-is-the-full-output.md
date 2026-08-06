# Proof is the command's own exit code and the FULL failure list — never a trimmed tail

**One line:** two output-reading shortcuts in one session each manufactured a false
verdict — a pipe to `tail` swallowed a FAILED verify's exit code (the pipeline
returns tail's status, so "exit 0" meant tail succeeded, not verify), and
`| tail -3` on test runs cut the `N failed` header off failure lists, which read
as passes and sent a broken-suite diagnosis toward "flake" for half an hour.

**Where it bit (2026-08-06, K.1 session):**
- `bash scripts/verify.sh 2>&1 | tail -20` ran in the background and the task
  notification said exit 0. The log's last line was `❌ VERIFY FAILED`. The exit
  code belonged to `tail`. A "baseline passed" claim was made from it and later
  had to be retracted.
- `npx playwright test <5 specs> | tail -4` showed `3 failed …transaction-status…`
  and `34 passed`. The two OTHER deterministic failures in that run were above the
  cut. Conclusion drawn: "the rest pass in isolation → parallel flake." Wrong —
  they fail every time, and proving that later took three more runs.

**The rules:**
1. Exit codes come from the command itself: `cmd > log 2>&1; echo "EXIT=$?"` —
   never from a pipeline over it (`cmd | tail` returns tail's status).
2. A failure list is only read whole: `grep -E "failed|passed|did not run"` over
   the FULL log, or the run's summary line — never `tail -N` and hope the header
   made the window.
3. Before calling anything "flake", reproduce it twice: once in the suspect
   arrangement, once in a minimal one — and diff the FULL lists. Deterministic
   pre-existing breakage looks exactly like flake through a keyhole.
4. This is LOOP_ENGINEERING rule-3's hard exception wearing shell syntax: gate
   proof is pasted real and unedited, and an exit code you didn't capture is
   proof you don't have.
