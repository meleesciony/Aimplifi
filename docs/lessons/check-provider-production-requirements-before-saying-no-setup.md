# Check a provider's PRODUCTION requirements before telling the owner "no setup needed"

**When:** 2026-07-24, a full day of live Plaid-connection debugging (#280–#285).

## What happened

At the very start of the session the owner showed the Plaid "Basic setup" checklist
(Complete account setup / Run Quickstart / Set up front-end integration / Call
endpoints) and asked: *"do I need to set this up?"* The answer given was a confident
**"no — your integration is already built, ignore that checklist."**

That was true for *that checklist* (it is Plaid's throwaway developer tutorial), but
it was over-generalized into "nothing is needed on Plaid's side at all." It was wrong.

The real, mandatory production gate was **Data Transparency Messaging (DTM)**: Plaid
requires at least one **use case** to be configured *and Published* in the dashboard
Link Customization ("default" customization) for Link to work in Production
(1033-rule consent, enforced for new US/CA customers since 2024-10-31). Because it was
unconfigured, Plaid Link **EXITed at institution-select** for EVERY OAuth bank
(Chase, Amex, Capital One) with `INVALID_LINK_CUSTOMIZATION (INVALID_INPUT)` — and
crucially with **no client-side error, no server hit, and no bank page** (the modal
just vanished). Configuring the use cases (`Track and manage your finances` /
`Pay down debt` / `Invest your money`) and clicking **Publish changes** fixed it
instantly.

## The costly detour

Because the provider-config possibility was dismissed up front, a "fails on every
device, every bank, silently" symptom got chased through browser extensions (a
CSP-rewriting crypto/identity extension), CSP directives, www-vs-apex domains, service
workers, and two real-but-not-root code fixes (#283 reCAPTCHA CSP, #284 open-in-user-
gesture) — hours — before the actual cause surfaced. The owner had literally asked
about Plaid config in the first message.

## Lessons

1. **"Do I need to configure anything on the provider's side?" is never answered from
   memory or from one visible checklist.** Verify the provider's *production launch
   requirements* (Plaid's launch checklist / Data Transparency / OAuth institution
   enablement) before saying no. A built, code-complete integration does NOT imply the
   provider-side config is done.
2. **For a "fails everywhere, silently, no error" symptom, instrument the provider's
   OWN event stream FIRST, not last.** Plaid Link's `onEvent` (OPEN → SELECT_INSTITUTION
   → OPEN_OAUTH → EXIT with `error_code`) named the cause in one screenshot. Every hour
   before that was inference. Environmental theories (extensions, CSP, cache) should
   never outrank the provider telling you its own exit reason.
3. **A universal symptom (every device incl. a wiped phone) points at config/server,
   not the client.** That alone should have deprioritized extension/CSP/browser theories
   from the start.

## Kept vs reverted

- `#283` (reCAPTCHA CSP allowances) and `#284` (open() in the click gesture) are real
  correctness fixes and were **kept** — they were just not the root cause.
- `#281`/`#282`/`#285` on-page diagnostics were **removed** after they did their job
  (proving `onExit` never fired = a Plaid-internal close, then surfacing the exact
  `INVALID_LINK_CUSTOMIZATION` event).
