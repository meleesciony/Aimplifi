## §Card-identity (the /cards identity line — `components/finance/card-identity-view.ts`, DECISIONS #289)

Hand-verified expectations for `cardIdentityLabels`, locked by `tests/unit/card-identity-view.test.ts`.
The caller passes the DISPLAY-ordered card list; the map is keyed by `cardId`, which IS `Account.id`
(`cash-needed/assemble.ts:157` → `engine.ts:164`).

**A. Distinct names — the last-4 is additive, not a disambiguator.**
Cards "Venture" (mask 6271) and "Spark Miles" (mask 5154) → `{a: '····6271', b: '····5154'}`.
A uniquely-named card with NO mask gets no entry at all — an identity line that says nothing is noise
on a dense money surface.

**B. THE REPORTED SHAPE — three cards named `CREDIT CARD`.**
Masks 0977 / 2927 / 4105 → `····0977`, `····2927`, `····4105`. The name is unchanged; the
last-4 is the whole discriminator, and it is REAL data — never parsed out of the name (#292: a
parenthesized year and the x in "Amex" both mis-read as a last-4).

**C. Nothing in the data separates them — the numbering fallback.**
Two cards named `CREDIT CARD`, neither masked → `1. no card number on file` / `2. no card number on
file`. EVERY card is numbered once any two would tie, including already-unique ones: a number on only
some cards would read as a property of those cards rather than as a position in the list. Two cards
sharing a name AND a mask → `1. ····0977` / `2. ····0977`.
The number indexes the array it is HANDED, and the component hands it the displayed `ordered` list,
so the numbers read 1, 2, 3 down the page. It is a within-view marker, re-assigned if the toggle
reorders the list — never a durable name, which is why nothing else refers to it.

**D. The tie test compares what is PAINTED.**
Card "Venture" masked 0977 paints "Venture ····0977"; a card literally NAMED "Venture ····0977"
with no mask paints the same thing (those glyphs are copyable off /accounts). A separator-joined key
calls them distinct and skips the numbering — so the comparison is the rendered string, sanitized.
Both are numbered.

**E. The last-4 is validated, and the dots never over-claim.**
`lastFour` keeps digits only and takes the final four: a full PAN `4111111111111111` renders
`····1111`, never the raw value (nothing enforces schema.prisma:155's "last 4 only", and Plaid's
value is stored verbatim). A short issuer mask `12` renders `ending 12` — NOT `····12`, because four
dots would claim four digits. A digitless mask (`"n/a"`, whitespace) is treated as no number at all.
`••••0977` → `····0977` (separators a feed might include are stripped).

**F. Scope coverage.** The map is built server-side from `cashNeededSnap.accounts` — the
household-MERGED snapshot the obligations are computed over — not from the personal `snap`, so a
partner's card carries its identity too. A partner's last-4 is already part of what a shared account
discloses (docs/PRIVACY.md: name, type, last-4 mask, current balance).

**Known limitation.** `Account.mask` is written ONLY by the Plaid path (`plaid-map.ts:121`); SimpleFIN
never sets it and a manual account hardcodes null (`networth-actions.ts:52`), and the demo seed writes
none. So a SimpleFIN-only or manual-only user gets the numbering fallback rather than real last-4s,
and demo mode exercises the fallback only.
