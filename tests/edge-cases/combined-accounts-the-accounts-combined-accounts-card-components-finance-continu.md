## §Combined-accounts (the /accounts "Combined accounts" card — `components/finance/continued-accounts-view.ts`, DECISIONS #288)

Hand-verified render expectations for `continuedAccountsView`, locked by
`tests/unit/continued-accounts-view.test.ts` and `tests/unit/continued-accounts-critic.test.ts`.
`AccountReconciliation.successorAccountId` is NOT unique (`prisma/schema.prisma:193`), so N
predecessors may fold into one successor; the card renders ONE block per successor.

**A. One old account into one live account (the ordinary case).**
Input: one link, predecessor "Venture Rewards" (simplefin, mask null), successor "Venture" (plaid,
mask 6271), cutover 2026-07-18.
- block title: `Venture` / `(Plaid ····6271)`
- `combinesLine`: null (nothing is being combined that needs counting)
- `chainedLine`: null
- source line: `Continued from your old account Venture Rewards (SimpleFIN) — history kept through
  2026-07-18; this old account's balance no longer counts on its own.`
- Undo face: `Undo` — a bare face is honest only because it is the card's ONLY Undo
- Undo accessible name: `Undo — separate Venture Rewards (SimpleFIN) from Venture (Plaid
  ····6271); that old account counts on its own again`

**B. THE REPORTED DEFECT — two old accounts, one live account, identical names.**
Input: two links, both predecessors named "Venture" (simplefin, mask null), both into successor
"Venture" (plaid, 6271), both cutover 2026-07-18. Nothing in the DATA distinguishes them.
- ONE block (not two rows), `sources.length === 2`
- `combinesLine`: `Combines 2 old accounts into this one. Each is listed below and can be undone on
  its own.`
- source lines differ ONLY by the ordinal, which is what makes them tellable apart:
  `Old account 1 of 2: Venture (SimpleFIN) — history kept through 2026-07-18; this old account's
  balance no longer counts on its own.` and the same with `Old account 2 of 2`.
- Undo faces: `Undo old account 1: Venture` / `Undo old account 2: Venture` — distinct because the
  ordinal sits at a fixed offset ahead of the name, so no name can forge a tie.

**C. Two live accounts that would each render one identical Undo (cross-block tie).**
Input: predecessors both "Venture", successors "A" and "B" (different ids).
- Every control is numbered by card position: `1. Undo: Venture`, `2. Undo: Venture`
- the SAME number is prefixed onto each source line, so the discriminator the user is asked to read
  is anchored in the prose beside the button, not invented on the control alone.
- Why this is unforgeable for ANY input: label `i` becomes `"{i}. " + label`. For i ≠ j, decimal(i)
  and decimal(j) either differ at a digit, or one is a strict prefix of the other — in which case
  the shorter is followed by `.` where the longer has a DIGIT. A digit is never `.`, so the two
  differ at a fixed offset no matter what follows. (The earlier "(copy N)" suffix was NOT safe: it
  appended into the same string space it compared, so a predecessor literally named
  "Venture (copy 1)" tied with a rewritten "Venture" — 39 of 4000 fuzz seeds.)
- A block folding in exactly ONE old account never says "old account 1" — it never enumerated
  anything, so the face is `Undo: <name>`.

**D. Names that differ only in invisible characters.**
Input: predecessors "Venture", "Venture " (trailing space), "Ven<U+200B>ture", "Venture  " (double
space), under four different successors. Provider names are stored untrimmed
(`simplefin.ts:475`, `plaid.ts:344`), so this is ordinary input.
- all four sanitize to the SAME rendered name `Venture` (NFC, strip
  C0/C1/bidi/default-ignorable, collapse whitespace, trim)
- therefore the tie is REAL and the numbering fires: four distinct faces, all containing
  `Undo: Venture`. Comparing raw strings would have found four "distinct" labels that paint
  identically on screen.
- A name of `"\u202eVenture\u202c evil"` renders as `Venture evil` — the override that would have
  reversed the rest of the button face is stripped, not escaped.
- A name that sanitizes to nothing renders as `Unnamed account`, never an empty control face.

**E. Chain Q → P → S (a mid-chain node is NOT live).**
Input: link 1 predecessor "Q old" → successor "P mid" (id P); link 2 predecessor "P mid" (id P) →
successor "S live".
- `getFinanceSnapshot` emits each link with its DIRECT successor (`transactions.ts:525`) and the
  boundary zeroes EVERY predecessor's balance (`reconcile-boundary.ts:419`), so P heads its own
  block while contributing $0 and while being folded into S one block below.
- The P block therefore carries `chainedLine`: `This account was itself later combined into another
  one, shown in its own block below. Its balance does not count here.`
- The S block's `chainedLine` is null.
- No source line in either block claims where the balance WENT — the module receives neither
  successor liveness nor the claim span, so it states only the fact that is true in every state:
  the old account's balance no longer counts on its own.
