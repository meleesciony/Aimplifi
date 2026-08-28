## §Ask Largest-Purchases Merchant Scope (DECISIONS #230 — TASKS 2.7, `largestScope` / `largestPurchases`)

| Input | Result | Why |
|---|---|---|
| "biggest purchase at costco" | largest scoped to merchant `costco` | at/with/from after the noun is the merchant construction; same `merchantMatches` semantics as merchant_spend |
| "biggest purchase from costco" | scoped to `costco` | "from" joined the anchor (critic F2) |
| "biggest purchase at the moment" | GLOBAL ranking | a licensed idiom is not a store (critic F1; was "No purchases at Moment") |
| "biggest purchase at the end of last month" | GLOBAL, window last month | idiom falls through; the timeframe rule reads the window |
| "biggest purchase at least $100" | abstain | a threshold we cannot represent — never merchant "least 100", never the unfiltered global answer |
| "at best buy" (largest or spend) | merchant `best buy` | a head word from idiom vocabulary + a real word is a store, not an idiom |
| "At Costco, what was my biggest purchase?" | abstain | fronted objects never anchor (mirrors the spend family) |
| "biggest purchase with amex" / "with my credit card" | abstain | #168 — payment methods are not merchants |
| "biggest purchase at 星巴克" / "at 🍕" | abstain | unreadable names abstain everywhere |
| "biggest grocery purchase" | abstain | a category-scoped ranking no engine computes |
| "biggest costco/walmart/bank purchase" | abstain | an attributive scope we cannot resolve (critic F2; was the GLOBAL ranking, unhedged) |
| "my single biggest purchase" | GLOBAL | benign intensifiers keep the global answer |
| "biggest charges last month" | GLOBAL, last month | "charges" is the fees synonym's word but sits in NOUN position — never category-abstained |
| "the most expensive thing i bought" | GLOBAL | an intervening largest-noun word means the real noun sat adjacent — no modifier |

Scoped ranking + copy: `largestPurchases(rows, tf, limit, today, meta, merchant?)`
filters by `merchantMatches` before ranking (unscoped call byte-identical);
scoped headline "Your biggest purchase at <top-match canonical> <label> was $X.",
scoped empty "No purchases at <TitleCase query> <label>.". The frame carries the
merchant on window swaps and re-scopes on "what about at X?" (supersedes #223
P2-5, which abstained because no engine computed it).

**Deliberate ambiguity trade (critic cycle 2, N-2):** a bare single idiom word
after at/with reads as the IDIOM, not a store — "how much did I spend at
most/at max/at best" answers the total (before 2.7 every one of them answered a
confident-wrong "No spending at Most…"). A store literally named "Max" or
"Best" loses that phrasing (reachable via "at Max's" / any multi-word form:
head-word + a real word stays a store — "best buy", "top golf", "first watch"
all keep their merchant answers). And account self-reference is a payment
SOURCE, never a store (critic N-1): "from my checking account" abstains; the
cost is "at Bank of America" also abstaining (honest redirect, recorded).

---
