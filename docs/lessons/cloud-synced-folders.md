# Don't develop in cloud-synced folders

**Summary:** OneDrive/Dropbox/iCloud sync holds file locks that make `verify` fail spuriously and
forces LF→CRLF churn; keep the checkout on a plain local disk.

**What happened:** The original checkout lived under
`C:\Users\micha\OneDrive\Documents\Pulse Finance`. Background sync intermittently locked files, so a
cold `tsc` / `eslint` / `next build` could fail once and pass on a clean rerun, and every touched file
churned line endings. Relocated to `C:\dev\Aimplifi` on 2026-06-27.

**Why it mattered:** Hours were lost debugging "failures" that were environment flakes, not code
defects — a direct threat to the no-fabrication/loop-closure discipline, since verify output couldn't
be trusted.

**How to apply:** Work only from `C:\dev\Aimplifi`. Treat a one-off cold-start verify failure that
doesn't reproduce on a clean rerun as an environment flake, not a code defect — rerun before
diagnosing.
