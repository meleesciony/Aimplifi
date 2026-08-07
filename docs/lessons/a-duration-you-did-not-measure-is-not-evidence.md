# A duration you did not measure is not evidence — and "it's been ages" is not a measurement

**One line:** a CI run that had been alive for **5 minutes 6 seconds** was cancelled as "hung for
~55 minutes" — the 55 came from counting my own polling turns, not from reading a clock, and the
repo's own norm for that run is ~10–11 minutes, so the fabricated number killed a healthy gate
one third of the way through it.

## What happened

Push `7f70328`, verify run 31200587384. I polled it several times, saw `in_progress` on each poll,
and wrote: *"its `verify` step sat in progress for ~55 minutes against a ~10-minute norm."* Then I
cancelled it and started attempt 2 to "distinguish a stuck runner from a real hang".

The API says otherwise, and it was one call away the whole time:

```
attempt 1: job started 2026-08-07T17:04:41Z, completed (cancelled) 2026-08-07T17:09:47Z
```

**Five minutes and six seconds.** Well inside the normal envelope. There was no hang, no evidence
of one, and nothing to distinguish. The wait had felt long because a conversation turn is not a
unit of time: several waits ran as concurrent background tasks and overlapped, so "how many times
did I check" measures my own polling, not the world.

## The rules

1. **Elapsed time is read from a clock, at both ends.** `started_at` and `now` are two API fields
   and one subtraction. Any sentence of the form "this has been running for N minutes" that did
   not perform that subtraction is a fabricated number wearing a unit — the same class of claim as
   "it's probably an env var", and CLAUDE.md rule 0 already bans it. The unit is what makes it
   convincing, which is what makes it dangerous.
2. **Turn count, poll count and "it feels long" measure the observer.** Especially with background
   tasks: overlapping waits inflate the perceived interval without a single extra second passing.
   If the only instrument is a memory of having checked a few times, there is no instrument.
3. **Cancelling is a destructive act on evidence, so it needs a measurement first.** The cancel
   destroyed the run whose logs would have shown where it actually was, and cost a full re-run.
   Cheap-looking reversible-ish actions still need their premise checked when the premise is the
   only reason for acting.
4. **Compare against a measured norm, and get the norm the same way.** The ~10-minute baseline was
   real (eight recent runs, from the API). Half a comparison measured and half imagined is not a
   comparison — and the mismatch should have been the tell: a number 5× a well-established norm
   deserves a second look BEFORE it justifies an irreversible step, not after.
5. **Correct it out loud, in the same channel that carried the claim.** The false "~55 minutes"
   went to the owner in a status update. A quiet fix leaves them holding a wrong fact about their
   own CI.

## The tell, for next time

The sentence had no timestamps in it. Every honest duration claim in this repo's ledgers carries
its two ends (`17:04:41Z → 17:09:47Z`) precisely so the reader can check the subtraction. If a
duration is about to be asserted and neither end is on the page, stop and go read the clock.
