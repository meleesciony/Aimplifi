## §Doc Extractor v1 (AI plan §3.3 reshaped — `engine/doc-extract/statement.ts`, DECISIONS #247)

The model is a span-pointer only — the JSON contract has NO value channel; every prefill
value is derived by code from a span verified to exist verbatim in the (scrubbed) text the
model saw. Every ambiguity abstains (human types the field); the save still runs the
byte-identical `parseManualStatement` gate behind a human confirm. Hand-verified in
`tests/unit/doc-extract-statement.test.ts` + `statement-extract-server.test.ts`:

Scrub (before any egress — digit runs ≥ 9, up to TWO whitespace/dash chars between digits;
best-effort masking, and the UI disclosure says so — critic cycle-1 P1-2):
- `4400 1234 5678 9010`, `4400  1234  5678  9010` (columnar double-space), `4400 1234\n5678
  9010` (PDF line wrap, incl. `\r\n`), `1-800-555-0199`, `123456789` → `[removed]`
- `12345678` (8 digits) survives; `06/15/2026 - 07/14/2026` survives (slash + the 3-char
  ` - ` gap break runs); `$1,234.56` survives (comma/dot break runs)

Validator (`parseLlmStatementExtract`):
- confidence 0.98 → 9800 bps; 1.0 → capped 9900 (10000 reserved for a human origin)
- `{fields:[]}` → replied-empty; non-object / non-array / all-claims-invalid → null (rejected)
- a field claimed twice → dropped ENTIRELY (conflicting claims abstain, no coin flip)
- span empty / whitespace / > 160 chars → claim dropped
- a LABEL-FREE span (no letters, e.g. `$980.11`) → claim dropped — the quoted span must give
  the reviewing human the statement's own wording to check the labeling against (cycle-1 P2-2)

Money derivation (exactly-one-candidate across BOTH tiers):
- `New balance               $1,234.56` → `1234.56` (123456¢); `$1,234` → `1234`;
  bare `35.00` → `35.00`; `$ 35.00` → `35.00` (a bare token inside the `$` token is the same
  candidate); a date in the span cannot shadow the `$` token
- two `$` tokens → abstain; bare integer `35` → abstain; a `$` token COEXISTING with a
  distinct bare token (`Pay 35.00 toward $1,234.56`) → abstain (cycle-1 P2-1)
- malformed money (`$1,234.567`, euro-grouped `$1.234,56`) → abstain, never a truncation
- recognized negative forms → abstain (a credit balance must not lose its sign into a
  plausible positive prefill — cycle-1 P1-3): ASCII `-$45.00` / `$-45.00` / `-45.00`,
  unicode minus/en/em-dash `−$45.00`, accounting parens `($45.00)`, `CR`/`credit`
  suffix `$45.00 CR`, trailing minus `45.00-` / `$45.00−` (ledger style), and a `CR`/`CREDIT`
  word immediately before the token `CR $45.00` (cycle-2 NEW-1). (A longer textual prefix
  like "Credit balance: $45.00" is NOT recognized — the quoted span carries those words for
  the human; this is the recorded residual. Side effect of dash normalization: a lone money
  token followed by ` - text` abstains — safe direction, rare in single-line spans.)

Date derivation (4-digit-year formats only: ISO, M/D/YYYY read US month-first, Month D YYYY):
- `08/10/2026` → 2026-08-10; `July 14, 2026` / `Jul. 14th, 2026` → 2026-07-14
- `08/10/26` (2-digit year) → abstain; `02/30/2026` (non-calendar) → abstain;
  two dates in a dueDate span → abstain
- cycleEnd ONLY: a range of exactly two ascending dates joined by `-`/`to`/`through`
  (`Statement period: 06/15/2026 - 07/14/2026`) → the LATER date (a period's end is
  deterministic); no separator / reversed / three dates → abstain

APR: exactly one %-token (`24.99%` → `24.99`; `0.00%` promo is a real value); bare `24.99`
without `%` → abstain; two %-tokens → abstain.

End-to-end fixture (grounded → `parseManualStatement`): balance 123456¢, min 3500¢,
cycleEnd 2026-07-14 (range end), due 2026-08-10, APR 2499 bps, derived cycleStart
2026-06-14, close DOM 14, due DOM 10. A span quoting the pre-scrub account number cannot
ground (the number is gone from the text the model saw).

Server fences: demo extract is a null no-op with ZERO provider calls (keyed deployment);
the provider request body never contains an unscrubbed account number; no key /
provider error / 7s hang → null → the honest "enter the fields manually" copy;
per-user durable rate limit (`statement-extract:{userId}`, 10/min) → honest error with
ZERO provider calls when exceeded (cycle-1 P1-4).
