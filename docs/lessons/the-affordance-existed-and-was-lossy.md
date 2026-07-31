# The affordance already existed and was lossy — "add a way to X" rarely means X is missing

One-line summary: the owner asked for "a way to go back" and there were already two
"Back to transactions" links; both were a bare `/transactions` that discarded his
filter, so the feature to build was not an affordance but the *fidelity* of the ones
already shipped — and a request phrased as an absence should be checked against the
surfaces that claim to do the thing before anything new is designed.

## What happened

O.16, owner verbatim: *"Can you add away to go back to what we were doing after let's
say changing a rule? Right now I have to click activity again and needs category"*.

Read literally, that is a request for a missing control, and the task row scoped it
that way: thread a return context into `/rules`. The measurement said otherwise.
`/rules` already ended with a link to the transaction list (`rules/page.tsx:130`), and
the transaction detail view already rendered "Back to transactions"
(`transaction-detail-view.tsx:1110`). Both were `href="/transactions"` — bare. Following
either one landed him on the *unfiltered* register at page 1, which is precisely the
state he described having to rebuild by hand ("click activity again and needs category").

He was not missing a way back. He had two, and both silently threw away his place. That
is why his sentence names the repair steps rather than the missing button: a reader who
has no control says "there's no way back"; a reader whose control is lossy describes the
work he does afterwards.

## Why this is the transferable part

The literal reading and the measured reading produce **different-sized fixes in
different files**. Building "a way back" onto `/rules` would have shipped a third link
beside two existing ones, left the detail view (where split, "Recurring…", the status
control, and the row's own main link all land) exactly as broken, and left the owner
with a page that behaved one way and a neighbouring page that behaved the old way one
click later.

The generalisation: when a request is phrased as an absence ("add a way to…", "there's
no…", "I can't…"), enumerate the surfaces that already CLAIM to do it before designing
anything. A claim that is present but lossy reads to the user exactly like an absence,
and it is a different bug with a different blast radius — usually larger, because a
lossy claim is duplicated wherever the claim is.

## Corollaries

- **Scope by destination, not by action.** The task offered a binary — rules-only, or a
  return context threaded through all ten row actions. Both were wrong. Five of the ten
  never leave the register (three open a panel in place; two reload the same URL), so
  threading context through them is dead code. The other five leave for exactly TWO
  destinations. The context belongs to the destinations, which is one shared module and
  two consumers instead of ten call sites — smaller than the "honest" option and
  strictly more complete than the narrow one.
- **A delegated mechanism is a hypothesis, and this one was false in a way the repo had
  already written down.** The subagent auditing row actions reported that the register's
  `window.location.reload()` "loses all query params" and concluded the friction was
  rules-only. `reload()` re-requests the current URL, params included — and
  `transaction-detail-view.tsx:246` already carried a comment saying so, which is why
  that file deliberately uses `assign(pathname)` instead. Adopting the agent's root cause
  would have put a false mechanism in the design and mis-scoped the slice. The repo rule
  held: reproduce a delegated finding before it enters a decision.
- **The same query string is a fix on one page and a bug on another.** The detail view
  drops its whole query after a write ON PURPOSE, so a confirmed save does not re-render
  the "we could not confirm it" banner. The reader's place now rides in that same query.
  "Keep everything" and "drop everything" are both wrong once two unrelated facts share a
  namespace — carry the one, re-add the other only when this write is what set it.
- **Close an open-redirect class by construction rather than by validation.** `?back=`
  arrives from the URL bar. Rather than sanitising a path, the decoder takes only the
  QUERY from the caller and always rebuilds against the `REGISTER_PATH` literal, so no
  input can express another destination — `?back=https://evil.example` parses as a query
  string, matches none of the ten register keys, and decodes to null. There is no
  validator anyone can forget to call.
- **Validate the VALUES, not just the keys, or the label lies.** The register falls back
  to "no filter" on an unknown `reimb`/`type`/`unclassified`/`page`. Carrying such a
  value would have rebuilt a URL landing on the UNFILTERED register beneath a link
  reading "Back to your filtered activity" — the guard has to read the same input as the
  thing it guards.
- **A "Back to <name>" is a claim about the reader's own history.** Name a single filter
  only when it is the sole axis; a second axis means the name describes a bigger set than
  he will land on. Carrying only `page` is a place worth returning to but is not
  "filtered". With no recognised context, say nothing and keep the copy that was already
  there — an affordance that renders unconditionally passes every positive test while
  making a false claim on the majority of visits, which is why the negative (absence)
  case is the load-bearing e2e assertion.
- **The e2e found the door the author's own enumeration missed.** I wired the action-menu
  hrefs and the row's "Rule…" link and believed the sweep complete; the spec's third test
  clicked `txn-detail-link` — the row's MAIN link into the detail view, the commonest
  door of all — and it was still bare. Enumerating outbound links by grepping `href=` in
  the file beat enumerating them from memory.
