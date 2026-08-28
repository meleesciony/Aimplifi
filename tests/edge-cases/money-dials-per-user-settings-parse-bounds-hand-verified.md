## §Money-Dials (per-user settings — parse + bounds, hand-verified)

The `src/lib/engine/settings/dials.ts` validator is the single boundary where the
free-text settings form becomes the typed `swrBps` / `expectedReturnBps` /
`hourlyWageCents` the FI and cash-needed engines already consume. Parsing is
string-only (no float math): a percent has exactly 2-decimal resolution (1 bps =
0.01%), dollars reuse `centsFromDollarString`.

- **Percent → bps:** `"4"` → 400; `"4.25"` → 425; `"0.5"` → 50; `"7%"` → 700;
  `" 6.5 "` → 650; `"100"` → 10000 (parses, then bounds-rejected). Malformed → reject:
  `"4.255"` (>2 dp), `"1000"` (≥4 integer digits), `"-4"`, `"4."`, `"%"`, `"1,000"`.
- **Dollars → cents:** `"38"` → 3800; `"38.50"` → 3850; `"0.05"` → 5. Malformed →
  reject: `"$38"`, `"38.555"`, `""`.
- **Bounds (reject outside; the FI engine stays well-defined inside):**
  - SWR 100–1000 bps (1%–10%). `fiNumberCents` THROWS on `swrBps ≤ 0`, so `0` MUST be
    rejected. Sanity check at the floor: `fiNumberCents($12,000/yr, 100)` =
    12,000 × 100 = **$1,200,000.00** (finite, no throw).
  - Expected return 0–1500 bps (0%–15%). `0` is accepted (the FI engine's explicit
    "no growth" branch).
  - Wage 1–1,000,000 cents ($0.01–$10,000.00/hr); empty clears it (→ null).
  - Money dials: ≤ 12 budgetable category ids (picker write path). Stored leftover
    names resolve on read only when the match is unique; ambiguous/unknown tokens
    are dropped. Control chars stripped; case-insensitive dedupe.
  - Payment account: must be one the user OWNS and of type CHECKING/SAVINGS.
- **Error accumulation:** all invalid fields report at once (one round-trip), so the
  form never plays whack-a-mole.
- **Display round-trip:** `bpsToPercentInput`/`centsToDollarInput` (integer math)
  invert the parsers for every in-range value: 400↔"4", 425↔"4.25", 3850↔"38.50".

Covered by `tests/unit/settings-dials.test.ts` (80 cases) and the
`tests/e2e/settings-dials.spec.ts` round-trip.
