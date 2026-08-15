# A veto's blast radius is not the boolean's scope — and evidence too dangerous to GATE on is not too dangerous to SHOW

**One line:** U.14 widened one boolean that "only gates the weak name signal", verified that scope by
reading the code, shipped it green, and it was wrong twice — the same predicate feeds
`detectReconciliationCandidates`, where removing ONE candidate collapses a withheld ambiguity into
`list.length === 1` and renders a **one-click Combine**; and the widened parser reintroduced the
exact misread two prior critics had removed. Reverted the same session, with the evidence moved to
an advisory surface where a wrong answer is visible instead of silent.

## What happened

`duplicateSignals` has a veto, `masksDiffer`, that disqualifies the WEAK name signal when two rows
carry different last-4s. It read the `mask` column, which SimpleFIN never populates, so it was inert
across exactly the SimpleFIN→Plaid migration the feature exists for — measured on real data at nine
confirmed pairings between accounts that are not the same account. The fix looked contained: read
the number the way every feed renders it, keep the veto exactly where it already sat.

The scope claim was checked and it was true. `masksDiffer` is referenced once, gating the name
signal, with mask and balance matches untouched. That verification was real and it was not enough.

**P0-2, found by a fresh-context critic and independently by CI.** `duplicateSignals` also feeds
`detectReconciliationCandidates`. There, suppressing one candidate does not merely remove a warning
— it changes how many candidates a stale row has. The L.9 guard withholds every control when a
predecessor matches two live accounts ("it is one of these and we cannot tell which"); with one
suppressed, `list.length === 1` becomes true and the survivor is rendered as a **Combine button**.
Confirming it zeroes a balance. The e2e written for exactly this — *"a Roth is never offered against
a Traditional — the wrong pair is vetoed, the right one offered"* — failed in CI.

**P0-1.** The widened parser read `Roth IRA (2021)` as account number "2021", so a genuine duplicate
against a real mask stopped being flagged at all. This is the misread `#292` and dup-veto critics
F1/F2 had already removed from the veto path, and the new parser read TWO digits where the rejected
one read four — strictly more misreadings than the rule that had been banned. The comment forbidding
it was still three lines above the new code.

## The rules

**1. A predicate's blast radius is every CONSUMER of the thing it changes, not the lines that read
the variable.** The boolean gated one signal. That signal decides a candidate SET. A set's SIZE
decides a different consumer's branch. Trace the value forward until it stops changing anything,
and when it feeds a collection, ask what reads the collection's cardinality — `length === 1`,
`length === 0`, "the only one left" are all branches where removing an element flips behavior into
a different mode rather than doing less of the same thing.

**2. Suppression is not a smaller version of surfacing.** "It only hides a warning" was the mental
model. Hiding one of two warnings promoted the other from *ambiguous* to *actionable*. Removing an
item from a set can ADD capability elsewhere.

**3. Evidence too dangerous to gate on is not too dangerous to show.** The measurement behind U.14
was sound — 9 of 9 wrong pairings identified, 0 genuine ones suppressed. What was wrong was the
PLACE. On a gate, a misread silently changes what counts and what the app offers. On an advisory
line beside an Undo the reader already had, the same misread is a sentence they can ignore. When a
critic kills a change, ask whether the evidence was wrong or only its position; the second is a
move, not a deletion. U.14's parser now feeds only the U.15 link audit.

**4. When a prior critic banned a technique, widening it is not a narrower version of it.** Going
from a 4-digit parse to a 2-digit parse made the banned failure mode MORE likely while the commit
message described the change as scoped and conservative.

## The process failure, which is the repeatable part

`bash scripts/verify.sh` skips Playwright without `VERIFY_E2E=1`. It returned green — 6858 tests —
and that was reported as shipped. CI runs the full gate and failed on the test written for this
exact defect. **The local gate is the Definition-of-Done gate; the CI conclusion is the SHIP gate**
(CLAUDE.md rule 5), and the two differ precisely in the layer that catches cross-consumer effects.
A change to a shared predicate is the case where that difference matters most, so it is the last
change that should ever be called shipped on a local green.

Concretely: for any edit to a predicate consumed by more than one caller, run the e2e specs of every
consumer locally before pushing, or wait for CI before saying the word "shipped".

## Cost

About forty minutes live on production, no data harmed (the defect changes what is OFFERED and what
is WARNED; nothing auto-writes). One revert, one rebuilt test suite — the critic's mutation testing
showed 5 of 8 mutations to the new regex kept all 40 tests green, so the locks were nearly as weak
as the code.

## Retry (2026-08-15, DECISIONS #476)

The remaining defect was real: the veto was inert when one side had no mask COLUMN. The retry
stayed at a last-4 (4-digit, non-year name embedding) and refused every advertised 2+ digit group.
Schwab "...396 (396)" vs Plaid ····5351 is the same account and `accountNumbersConflict` is true
of it — that pair is why a number-conflict offer-guard is the same hide as the revert. 2-digit
plan codes stay name-only candidates; U.15 already shows that evidence after confirm.
