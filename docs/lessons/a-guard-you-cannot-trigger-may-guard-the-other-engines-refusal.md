# A guard you cannot trigger may be guarding the other engine's refusal

**One-line summary:** #790 removed a "never pair a row #788 already counted" guard because a probe showed
#788's own pairing always took such rows first — and the next critic built the case in one try from
#788's REFUSAL rule (two rows that both name a brokerage are never paired), restoring a double count.
Before deleting a guard that sits between two engines, list the other engine's refusals, not only its
acceptances.

## How it bit (2026-10-07, #790 critic cycles 2–4)

"Money you set aside" (#790) pairs a savings arrival with its other half on the reader's checking. A
checking row that "Money you put in" (#788) counts as a brokerage deposit must not also vouch for a
savings arrival. At cycle 2 the maker probed three shapes; in each, #788 paired the arrival with the
checking row itself ("landed in your account") and stopped counting the deposit — so the guard never
fired, and was removed as dead code.

Cycle 3's critic read #788's pairing and found `if (out.names && inn.names) continue;` — #788 refuses to
pair two rows that BOTH name a brokerage. A Schwab withdrawal arriving in savings and a Vanguard deposit
leaving checking the next day are exactly that: #788 counts the Vanguard deposit, and #790 (without the
guard) paired the same checking row with the Schwab arrival — "$10,000.00 set aside" for $5,000.00. The
guard came back, broader (any row #788 reads as a brokerage's movement), and cycle 4's critic then showed
a second case (#788 pairs an unfiled Zelle with the arrival first) that needed its own failing test.

## The rule

- A guard between two engines is a claim about the OTHER engine. "It never fires" is proven only by
  enumerating that engine's refusal and ordering rules (what it will NOT pair, which pairs it takes
  first), then constructing one input per rule. Three happy-path probes prove nothing.
- If after that enumeration the guard still cannot fire, keep it only if a test can make it fire;
  otherwise remove it — but write the enumeration into DECISIONS so the next critic can check it.
- When a mutation of a guard survives, the missing test is usually one of the other engine's refusals.

Related: `a-fix-that-cannot-fail-a-test-is-a-hypothesis.md`, `a-guard-must-read-what-it-guards.md`.
