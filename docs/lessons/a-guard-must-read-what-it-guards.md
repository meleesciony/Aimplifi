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

## The rule

- When you add a guard in front of parser P, make the guard consume P's own tokenizer/normalizer output.
  If that means exporting an internal helper, export it.
- After writing an abstention, immediately write the *false-abstain* test: the legitimate inputs nearest
  the new boundary. The hostile-critic cycle that catches this costs far more than the five minutes.
