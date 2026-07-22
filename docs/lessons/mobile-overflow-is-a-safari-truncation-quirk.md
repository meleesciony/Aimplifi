# A mobile overflow can be invisible to Chromium AND Playwright's WebKit — test the owner's real engine, and don't ship a "fix" a green test never failed for

One-line: the owner's /accounts right-edge clipping (money values + Delete off-screen on iOS Safari) reproduced in NEITHER Playwright Chromium NOR WebKit 26.4 — at 360/393/430, with long synced names, 6/7-figure balances, or 150% text — because the cause was real iOS Safari's stricter flexbox `min-width:auto`: `LinkedRow`'s `<Link>` lacked `min-w-0`, so lenient engines shrink the flex item and truncate the name while the owner's Safari does not.

## What happened (#263)

Owner sent two iOS-Safari screenshots of /accounts. The visible defect was unambiguous — a WRONG figure (a half-visible number) is the cardinal sin here — but every attempt to reproduce it in the e2e harness passed green:

1. Wrote an objective gate first (`scrollWidth <= clientWidth` at 360/393/430) — proper regression discipline, fail-old before fix.
2. Falsified, in order: the net-worth summary line (two big figures fit at 360), a long **manual** name (ManualRow already truncates), a long **synced** name seeded straight into the e2e SQLite via better-sqlite3 (LinkedRow fit in Chromium), the **WebKit** engine (added an iPhone-13 `mobile-webkit` project — still fit), and **text scaling** to root 24px / 150% (still fit).
3. Ruled out a stale PWA cache: `public/sw.js` has no fetch handler and purges every cache on activate.

Only explanation left that fits ALL the evidence: **real iOS Safari's flexbox `min-width:auto`**. A flex item defaults to `min-width:auto` (won't shrink below its content's min-size). Chromium — and Playwright's WebKit 26.4, which is newer than a typical phone's Safari — shrink it anyway once a descendant is `min-w-0 + overflow-hidden` (`truncate`). Real iOS Safari is stricter: the intermediate flex item (`<Link>`) ALSO needs `min-w-0`, or the long name never truncates and pushes the number off-screen.

## The rules this yields

- **A green Chromium overflow test proves nothing about iOS Safari.** The suite rendered one Chromium width (380) and asserted nothing about layout — the bug shipped through both holes. Add an objective overflow assertion AND a WebKit project; the owner's engine is a first-class target, not an afterthought.
- **Playwright's WebKit ≠ the phone's Safari.** It tracks tip-of-tree WebKit and can be more lenient than the iOS version in a user's hand. A WebKit-green result narrows the cause; it does not clear it.
- **`min-w-0` must go on EVERY flex item down the chain to the truncating text**, not just the immediate parent. The canonical recipe: `<li className="flex min-w-0">` → `<Link className="flex min-w-0 flex-1">` → `<div className="flex min-w-0">` → `<span className="truncate">`. The number stays `shrink-0` and never clips; the NAME yields first.
- **When a locking test can't fail-old (the environment is too lenient), say so.** The gate is then a regression GUARD, not proof of the fix; the fix's confirmation is on-device (here, remote-control owner verification), and any still-open environmental variable (iOS Larger Text / Display Zoom) stays named, not assumed away. This is rule-0-honest, not a loophole.
- **Seed a synced (LinkedRow) fixture the manual-add UI can't make** by inserting `provider='simplefin'` directly into the e2e SQLite (better-sqlite3, same file the server reads) — the only way to render the real long-name linked row, since manual names cap at 60 chars and always render a ManualRow. Install `@types/better-sqlite3` or tsc fails the gate.
