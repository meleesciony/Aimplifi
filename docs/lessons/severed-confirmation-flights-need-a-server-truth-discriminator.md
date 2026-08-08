# A severed confirmation flight is harness, not product — prove it with the audit log, harden with an idempotent re-submit

**One-line summary:** under the e2e harness's 4-worker shared-SQLite load, a useActionState
confirmation flight is sometimes severed (the stream closes) while the server action executes
correctly — the test then fails even though no product code is wrong. The discriminator is the
server's own audit log (server executed ⇒ the flight, not the action, was lost), and the hardening
is a bounded re-submit retry that rides the action's product-level idempotency — never a weakened
assertion.

## The trap it sets

A reload-bearing mutation spec that submits once and asserts the confirmation fails *sporadically
under load, green solo every time*. The symptom (no confirmation rendered) reads exactly like the
product bug class this repo has been burned by twice (a mutation that silently didn't happen). Three
possible truths, one symptom:

1. the action never ran (product defect) —
2. the action ran but the result never reached the UI (harness severing) —
3. the action ran wrong (product defect).

The first investigation treated it as (1)/(3) and chased product hypotheses through multiple runs.
The audit log settled it in one query: every submit had executed server-side with the exact expected
values (`imported: 2` first, `imported: 0, duplicates: 2` second). The action was right every time;
what died was the confirmation stream. Trace forensics confirmed it: both POSTs returned `200
text/x-component` with `x-action-revalidated: 1`, the `_failureText: net::ERR_ABORTED` was the
client's own normal stream close after consuming the response, and the router-refresh `_rsc` GETs
fired after both — a clean flight that simply didn't revalidate the visible DOM under contention.

## How to discriminate (cost: one query + one trace)

1. Find a server-side truth channel the action writes — this app's `AuditLog` (action + meta JSON)
   is exactly that. Query it for the action's rows around the failing run. Server-side rows with the
   expected values ⇒ the action executed; the failure is downstream of execution.
2. Only then pull the Playwright trace for the two POSTs. `ERR_ABORTED` on the request is normal
   client-initiated close when both streams were consumed and the revalidation GETs fired; it is
   *not* evidence of a defect.
3. Reproduce deterministically: full file at 4 workers reproduces; solo is always green. That is
   the documented harness class (see `playwright.config.ts` workers comment), not a new product bug.

## The hardening that doesn't weaken the test

The assertion must not be relaxed — the product contract stays. Instead:

- **Hydration barrier (#167 idiom):** wait for the form to be visible after `goto` before fill/click;
  a submit racing page load can complete server-side with its confirmation applied to a dying
  document.
- **Bounded re-submit retry:** `await expect(async () => { if (button enabled) { fill; click; }
  await expect(result).toContainText(...) }).toPass({ timeout })` — re-clicking is what a real user
  does, and the retry is only *safe* when the action is idempotent by product design. This importer
  is (re-importing a fully-duplicate file writes nothing), so each retry re-runs the same harmless
  dedupe. The final register-count assertion is the authoritative proof regardless of which branch
  the retry took.
- **Branch on the result:** a fresh-import result and a dedupe-retry result assert different
  follow-ups (depth line shown vs. no depth claim); both are correct product behavior under the
  retry.

If the audit log shows the action did NOT execute, or executed with wrong values, the harness
excuse is dead — diagnose the product. The discriminator only clears flights, never wrongness.

## Standing guidance

- Before diagnosing a "silent no-op" e2e failure as a product bug, check the action's audit rows —
  it is the one source that separates "never ran" from "ran and the flight died".
- `next start` in the local harness serves the last build — rerun the spec against a fresh build
  before trusting a targeted run (`e2e-runs-a-stale-build.md`).
- This is the same load family as `e2e-dials-value-corruption-flake.md` / `ci-e2e-timing-flake.md`;
  CI remains the arbiter. A server-proven severing is recorded with run id + failing test names in
  `docs/STATUS.md` and named in the PASS/FAIL contract — never laundered into a green claim.
