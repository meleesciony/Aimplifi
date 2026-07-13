# A guard must read the same input as the thing it guards

**Summary:** a safety check that re-derives its own view of the input will eventually disagree with the
code it protects, and the gap between the two views is exactly where the original bug survives. Share the
token stream; don't re-parse it.

## How it bit (#226, cycles 1→2)

The Ask parser's merchant tokenizer strips every non-`[a-z0-9'&.-]` character, so a store named in a
non-Latin script vanished — and `how much did I spend at 星巴克 last month` fell through to the
ALL-SPENDING TOTAL: a true figure under a false question, unhedged. The cardinal sin.

The cycle-1 fix added a guard: abstain if the object after `at`/`with`/`on` contains non-ASCII. It
tested the **first whitespace token** after the preposition. But the tokenizer **skips leading articles**
(`the`, `a`, `an`, `my`) and then reads up to four tokens. Two different views of "where the merchant
starts". The next critic walked straight through the gap:

```
'how much did I spend at 星巴克 last month'      → unknown   ✅ fixed
'how much did I spend at the 星巴克 last month'  → spend_total  ❌ the identical bug, one article away
```

The fix is not a better regex. It is **one shared token stream** (`merchantTokenStream`) that both the
tokenizer and the guard consume, so they cannot disagree about the input by construction.

## The second half of the lesson: an abstention that widens is a regression

The same cycle-1 guard treated a **curly apostrophe** as unreadable — it is non-ASCII, after all. So
`how much did I spend at mcdonald’s` (what the iOS keyboard types by default) started returning
`unknown`, silently breaking every phone-typed possessive store name. And nothing could rescue it: the
LLM classifier is never offered `merchant_spend`, so the fallback path could not answer it either.

A safety guard is still a behavior change. Ask of every abstention: **what working input does this also
refuse?** Here the answer was "a large fraction of real mobile users." Fold the meaningless variation
(smart quotes → ASCII) *before* the test, so the guard refuses only what it actually cannot read.

## The real lesson (cycles 3 and 4): don't guard the sink — make the sink earn its answer

Two more cycles, two more escapes, each one syntactic inch away:

- **Cycle 3:** the guard's stop-word test ran on the *stripped* token. `星巴克last` strips to `last`,
  a timeframe cue, so the scan terminated before the raw bytes were ever examined. The stripped form of
  unreadable text is a **lie**; never consult it before the raw form.
- **Cycle 4:** the predicate had been narrowed to non-ASCII *letters* (so an emoji beside a name wouldn't
  cause a false abstain) — which said nothing about an object made **entirely** of symbols. `at ⓒⓞⓢⓣⓒⓞ`
  strips to nothing and fell through. The question was never "is there a symbol?" but **"did the object
  survive being read?"**

The fourth critic finally named the structure: **`spend_total` was the unconditional SINK of the spending
family.** Every guard was a filter on one sentence shape (verb → preposition → object), and the sink
*inherited* the answer whenever no filter fired. So each fix hardened a filter, and the input just moved:
a leading article, a glued token, a punctuation mark, a fronted object, a zero-width space.

The fix is an inversion, and it is the transferable part:

> A default branch that can produce a confident, money-bearing answer must **earn** it with a positive
> precondition — not inherit it by the absence of the failure modes someone happened to think of.

Concretely: readability became a *precondition of routing* (checked before category resolution, not after
it fails), and `spend_total` now requires `!containsUnreadableName(q)` to be returned at all — by the
parser, by the frame, and by the LLM's re-derivation alike.

## The rule

- When you add a guard in front of parser P, make the guard consume P's own tokenizer/normalizer output.
  If that means exporting an internal helper, export it.
- After writing an abstention, immediately write the *false-abstain* test: the legitimate inputs nearest
  the new boundary. The hostile-critic cycle that catches this costs far more than the five minutes.
- If you are writing the **third** guard in front of the same fall-through, stop guarding and invert: the
  bug is not in the predicate, it is in the branch that answers when the predicate says nothing.
- Normalize once, at the entrance (NFC), so two byte sequences a user cannot tell apart cannot route
  differently.
