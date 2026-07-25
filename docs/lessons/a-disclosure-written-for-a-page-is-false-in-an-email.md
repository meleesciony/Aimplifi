# A disclosure written for a page is false in an email — and on a channel that interrupts, silence is cheaper than suppression

Copy that qualifies a money figure carries an implicit claim about **where the reader is standing**. Move
it to another channel and the words stay identical while the claim stops being true. TASKS L.15 shipped the
same duplicate-card disclosure onto six new surfaces; every real design decision in the slice came from that
one fact.

## The three ways the claim breaks

1. **Positional words.** `"Both are counted in the total above"` and `"No amount below has been adjusted"`
   are true on /cards and the dashboard, where the writer controls what is above and below. In an email
   there is no "above" — the digest interleaves the payments section with a review, a receipts tally, and a
   household block, and the reminder email is read in a client that may collapse quoted text. The email
   variant had to say **"in this email"** and nothing else. This is the same rule DECISIONS #298 reached for
   the Plaid update notice: *copy that can render on more than one surface may name a page but never a
   position* — L.15 is that rule applied one channel further out.

2. **Figures the reader cannot see.** The /cards sentence quotes each card's cash-required amount, because
   both numbers are printed on screen and the claim is checkable. The Ask assistant prints a card COUNT and
   a total and no per-card figure, so it needed a sentence naming those two and only those. The Glass-Box
   trace prints rows, so it names rows. A builder per surface is not duplication — the only thing that
   differs between them is **what money claim is true there**, which is precisely the thing the module
   exists to get right.

3. **Controls that do not exist.** Every in-app variant ends by pointing at a dismiss/repair control. An
   email can point at no control at all, so its how-to had to become *"Open Accounts in Aimplifi"* — a
   destination, not a gesture.

## Suppression is not the merciful option

Web push was the one surface where disclosure competes with an interruption the reader did not ask for, and
dropping the second notification looked kind. It is not. Suppressing asserts the two rows are one card —
the claim only the user can make — and when that assertion is wrong the reader is **never told a genuinely
separate card is due**. Failure direction settles it, the same way it settled TASKS 2.8: disclosing when
wrong costs one redundant notification; suppressing when wrong costs a missed payment. Take the cheap
failure. (See `precision-fix-that-fabricates-is-worse-than-a-safe-superset.md`.)

The corollary is what the push sentence may claim. A pair is disclosable because both cards are in the
reminders list, but each notification is then filtered independently — autopay-covered, outside the window,
already delivered — so *"you will get two notifications"* is false whenever only one side survives. The note
names the other card and stops.

## Detect per run; never store the flag

All three cron channels compute the pair live rather than reading a persisted marker. A flag written last
week describes connections that may since have been deleted, combined, or dismissed as "not duplicates" —
and unlike a page, an email carries no control to correct itself. The live read is also nearly free: the
detector returns before it queries for anyone with no candidate pair, so the common case adds no database
round trip at all. Cheap enough to be current is always better than cached and stale.

## Where the copy module has to live

Three of the six consumers are pure engines under `src/lib/engine/`, and no module there had ever imported
from `src/components/` — so the shared copy module moved into the engine tree rather than inverting that
dependency, taking `renderSafe` with it (re-exported from its old home so existing importers were
untouched). Two notes on paying that cost safely: the extraction was proven behaviour-identical by a test
that feeds one character from **every range** in the invisible-character class plus the characters just
outside each range, because a mangled escape usually WIDENS a range; and the class itself had to be written
through `chr(92)` rather than typed as `\u0000`, since a shell heredoc mangles the escapes exactly as
`windows-codegen-via-shell.md` says it does — it silently wrote raw control bytes into the source twice
before the byte-level check caught it.

## The check that generalises

When a disclosure is about to render on a new channel, read every sentence and ask three questions: does it
name a position the reader cannot see, a figure this surface does not print, or a control this channel does
not have? Any yes means a new sentence, not a reused one.

## What the critics caught that the author did not

Three P1s survived a careful first pass, and all three are the same mistake in different clothes: a
property of the ORIGINAL surface had been baked into shared code as if it were universal.

**An identifier is only an identifier where the surface prints it.** The module had a positional
collision breaker — if two rows paint the same string, call them "1. X" and "2. X" — written for
/cards, where `cardIdentityLabels` renders that ordinal *into the heading the reader sees*. Run
unconditionally on the new channels it quoted labels that appear nowhere: an email prints bullets, a
push notification has no list, and the Ask answer paints no card names at all. Worse, it fired on the
DEFAULT case, because two connections to one real card return the *same* provider name — so the most
common shape produced the most confusing sentence. Whether a surface can be pointed at positionally
is a fact about the surface; it is now a required argument, and the indistinguishable case gets its
own sentence ("Two entries are both named X") instead of an invented identifier. When you cannot tell
two things apart, say so — do not manufacture a name.

**A defaulted parameter fails silent.** `traceCashNeeded` gained an optional `cardDuplicates`, and
the dashboard call site was updated. The Ask tap-through panel calls the same engine through
`traceCashNeededDerivation`, was not updated, and so kept rendering both rows under a green check
with a penny-perfect reconciliation — the single worst place for silence, since the reader opened it
*to audit the number*. Both critics found it independently. When an engine gains a disclosure
argument, grep its CALLERS, not the surface that reported the gap; tsc cannot see a default.

**The enumerated list is where the sweep starts, not where it ends.** The task named six surfaces. A
critic swept past them and found a seventh — Cash Flow Radar, which repeats every obligation across a
90-day horizon, so the duplicate is double-counted in *every projected cycle*. It manufactured a
CRITICAL "checking may go negative" push that would not otherwise exist and told the owner to move
**$33,100 instead of $13,050**: the only surface in the app that states a move-this-much figure, and
it interrupts. Two corollaries: after fixing a data class, ask what else consumes the same engine
output; and a channel that composes its own body (a push) does not inherit a disclosure you add to an
`assumptions` array.

## Two test lessons from the same cycle

A test for "this did not change" must compare against something the change cannot move. Four
assertions of the form `f(x, []) === f(x)` compared the post-change function with *its own default*,
and a critic's mutant that unconditionally appended the disclosure passed both sides. Golden literals
are the fix. And a header claiming the abstention tests were "the majority" was simply counted — 8 of
38 — and was wrong; if you are going to state a coverage property in prose, expect it to be measured.

## The fix for a P1 is where the next P1 lives

The seventh surface was found by a critic; the *fix* for it introduced the next P1, and cycle 2
caught that too. The radar disclosure resolved the pair against `cashNeeded.cards` — every obligation
the engine knows about — while its own comment claimed to read the projection. Those two sets differ
precisely where it matters: the projector drops anything with nothing still due and anything past the
horizon. So a paid-off duplicated pair, in no projected cycle at all, hedged a *genuine* overdraft
warning — telling someone facing a real dip that the amount to move might be inflated when it was
not. Same lesson as the ordinal defect, one level down: **resolve a claim about a computed set
against that set, not against its input.**

Two things follow. A comment asserting what code reads is worth nothing unless you check it against
the code — this one was wrong the moment it was written. And a pure-builder abstention test cannot
catch a wiring bug: it hand-builds the row list, which *is* the thing under test. The lock has to
drive the real engine.

**And then a third cycle falsified the fix to the fix.** Narrowing to "the pair is in the projection"
was still the wrong gate, because that is not what the sentence claims. It claims *the dip date may
be earlier and the amount to move larger than you need* — and both of those are fixed by the worst
point of the 90-day walk, not by the presence of dues elsewhere in it. An ordinary state pulls them
apart: a real crunch this week caused by a different card, with the duplicated pair due next month
and absorbed by payroll. Removing the duplicate moves neither figure, yet the reader was told the
$2,900 they had four days to move might be imaginary.

The general rule: **gate a disclosure on the counterfactual it asserts, not on a proxy that merely
correlates with it.** Here that means re-walking the projection without the suspected duplicate and
speaking only if the named figures actually move. Deciding whether to *speak* is not adjusting what
is *shown* — every displayed figure still comes from the real walk. It also dissolved a separate
finding for free (the note promising an earlier dip date under a header reading "Clear"), which is
usually the sign that a boundary is finally the right one rather than a patch.

Note the failure direction flipped between surfaces. On web push, disclosing was the cheap failure
and suppressing risked a missed payment. On the radar it is the reverse: a false hedge on a real dip
is what makes someone under-fund and overdraft, so silence is the cheap failure. Same product, same
week, opposite answers — which is why "always disclose" is a heuristic and the failure-direction
question is the actual rule.
