# Mobile UI brief — owner request 2026-07-21

Owner, verbatim: *"The mobile platform on my phone doesn't format correctly in the
accounts section and other sections. Please review mobile ui and make it more
functional and beautiful than simplifi, mint, and the best financial apps."*

This is the working brief for Wave M in `TASKS.md`. Everything below marked
**VERIFIED** was executed or read this session; everything marked **UNKNOWN** is
exactly that, and must not be guessed at.

## The one blocking question

**UNKNOWN: what "doesn't format correctly" actually looks like.** The sentence has
at least four readings with four different fixes — content running off the right
edge, columns crushed too narrow to read, content hidden behind the fixed bottom
tab bar, or everything oversized because iOS Larger Text / Display Zoom is on.

Ask the owner for: a screenshot of /accounts and of any other section that looks
wrong; the phone model; the browser; and whether iOS **Settings → Display & Brightness
→ Text Size** or **Display Zoom** is set above default. CLAUDE.md rule 0 — never
redesign a screen we have not seen.

The rest of Wave M (M.1 especially) is unblocked and worth doing regardless.

## Why this shipped: the test net has one hole the size of every real phone

**VERIFIED.** `playwright.config.ts:53-56` defines exactly one project:

```
name: 'mobile-380',
...devices['Pixel 5'],
viewport: { width: 380, height: 800 },
```

That is the *only* width the 143-test e2e suite ever renders at. Real devices in
CSS pixels: iPhone SE 375, iPhone 15/16 393, 16 Pro 402, Pro Max 430; Android
commonly 360, 384, 412. So 380 is narrower than most real phones — which means the
suite should catch right-edge overflow, and does not, because **no test asserts
anything about layout.** The axe scans check accessibility, and the rest assert that
elements exist. Nothing checks that the page fits, that text is legible, or that a
control is big enough to hit.

That is the actual root cause of "it passes here and looks wrong on my phone", and
M.1 fixes it before anything else: add 360 / 393 / 430 projects and a real overflow
assertion (`scrollWidth <= clientWidth + 1`) on every route the specs already visit.

**And the second hole: `/accounts` has no axe scan at all.** `phase5-a11y.spec.ts`
covers sign-in, dashboard, /cards, /triage, /coach, /calendar, /goals, /budgets and
/settings. It does **not** cover /accounts — the exact section the owner reported —
nor /transactions, /reports, /investments, /spending-plan, /ask, /trends,
/recurring, /forecast or /trust. The section with the loudest complaint is the
section with no accessibility floor, and that is not a coincidence worth ignoring.

## Verified defects, found by inspection this session

These are real, located, and independent of the screenshot.

**Tap targets far below the platform minimum.** iOS asks for 44×44pt, Android for
48dp. `src/components/finance/accounts-list.tsx` contains **8** controls styled
`px-1.5 py-0.5 text-xs` or `text-[10px]` — roughly 20px tall — and it is the worst
file in the repository by that measure. This matters because accounts-list is the
exact section the owner named. The same pattern appears in `transaction-list.tsx`
(4), `recurring-view.tsx` (4), `shared-transaction-list.tsx` (3),
`payment-reminders-card.tsx` (3), `ui/confirm-action.tsx` (2) and
`triage/triage-inbox.tsx` (2). "Doesn't work right on my phone" is a fair
description of a 20px delete button next to a 20px link button.

**Three-column grids with no responsive prefix.** Each of these renders three
columns at every width, including 360px:

- `finance/forecast-view.tsx:70` — milestones
- `finance/transaction-list.tsx:256` — the transaction summary
- `finance/retirement-outlook-card.tsx:155`
- `finance/recurring-view.tsx:195`
- `settings/money-dials-form.tsx:233`
- `triage/triage-inbox.tsx:570` and `:1073`

The failure case is a long money value — "$12,345.67" in a 100px column. Whatever
the fix per site (stack, horizontal scroll, or truncate), **a number must never be
silently clipped**: a half-visible figure is a wrong figure, which is the cardinal
sin this codebase is organised around.

**A wide fixed gap in a flex row.** `accounts-list.tsx` carries
`flex gap-6 text-sm text-muted-foreground` — a 24px gap that does not shrink, in a
row that holds several figures.

**A 288px dropdown inside a ~336px content column.** `transaction-list.tsx:415` and
`shared-transaction-list.tsx:185` both render the category picker as
`absolute left-0 z-50 w-72` — 288px fixed. The app shell gives mobile only 12px of
horizontal padding (`px-3`, widening to `px-6` at 640px), so on a 360px phone the
usable column is about 336px. transaction-list carries a
`max-w-[calc(100vw-2rem)]` guard; **shared-transaction-list does not.** Fix the
unguarded one and prefer a shared picker primitive over two near-copies — the
`#260` lesson about "identical" copies applies: diff them before extracting.

**The hero card concatenates card names with no break handling.**
`cash-needed-card.tsx:144` is `grid grid-cols-[auto_1fr_auto]` — date, card names,
amount on one line — with the names joined by `+` at line 154 and the date held on
one line by `whitespace-nowrap` at :146. Several real card names ("Chase Sapphire
Reserve + Amex Gold") in a 1fr middle column on a 360px screen is the most likely
single source of visible breakage, and it is the app's primary answer card.

**Fixed-width inputs with no responsive variant:** `triage-inbox.tsx` (`w-40` :684,
`w-44` :695, `w-24` :773), `accounts-list.tsx` (`w-24` :646),
`settings/custom-category-manager.tsx` (`w-40` :127, `w-44` :137),
`settings/household-card.tsx` (`max-w-40` :141, `max-w-60` :183/:339).

## Verified sound — do not "fix" these

Spending a slice re-doing correct work is the likeliest way to waste this wave.

- **Viewport meta is right.** `src/app/layout.tsx:24-30`: `width: "device-width"`,
  `initialScale: 1`, `viewportFit: "cover"`. Pinch-zoom is NOT disabled (no
  `maximumScale`), which is both correct and an accessibility requirement.
- **iOS safe areas are handled.** `src/app/globals.css:11-24` defines
  `env(safe-area-inset-bottom)` helpers, and `components/app-nav.tsx:198` pads the
  fixed bottom bar with `calc(5rem + env(safe-area-inset-bottom))`.
- **Zero raw `<table>` elements** exist in `src/` — the classic mobile-overflow
  culprit is already absent.
- **iOS auto-zoom on focus is already prevented.** `globals.css:60-66` floors form
  input font-size at 16px on touch devices. Do not lower it for aesthetics; below
  16px, iOS Safari zooms the page on every field focus.
- **The bottom tab bar's own tap targets are fine** — five links across the width is
  about 76px each, and the More sheet's buttons are `min-h-14`. The nav is not the
  problem; the content controls are.

The shell is fine. The problem is content-level layout and control sizing.

## What a redesign builds on

There is **no `tailwind.config.ts`** — this is Tailwind v4 with the theme expressed
as CSS custom properties in `src/app/globals.css:112-181`, on the shadcn `neutral`
base (`components.json`). Colours are already in **oklch**, which is the right
foundation for a considered palette; there is a `--radius` scale (`0.625rem` base
with sm→4xl variants) and chart + sidebar colour roles. Breakpoints are stock
Tailwind (sm 640 / md 768 / lg 1024 …), so **every phone is below `sm`** — mobile is
the unprefixed default, and `sm:` means "tablet and up".

shadcn primitives present: button, badge, card, alert, switch, confirm-action. The
card already has a `--card-spacing` custom property. So M.4 extends a real token
system rather than inventing one — the gap is a **type scale** and a **spacing
rhythm**, not colour infrastructure.

One shell note for M.4: the app wrapper is
`pb-bottom-nav mx-auto max-w-5xl px-3 sm:px-6` — 12px of horizontal padding on
phones. That is tight for a premium feel and is the single highest-leverage line to
revisit, but changing it shifts every route at once, so it belongs in the first
M.4 slice with the full suite re-run, not in a per-route pass.

## Scope reality

There are **19 authenticated routes** under `src/app/(app)/`: accounts, ask,
budgets, calendar, cards, coach, dashboard, forecast, goals, investments,
recurring, reports, settings, spending-plan, transactions, trends, triage, trust,
plus the shared layout. A single-session "make it beautiful" pass over 19 routes
would be a big-bang restyle with no gate — exactly the shape that produces
half-finished work. Wave M splits it: fix the net (M.1), fix the two mechanical
defect classes app-wide (M.2, M.3), then take the visual direction route by route
(M.4), one or two routes per slice.

For M.4, load the `frontend-design` skill before writing any styling, and establish
tokens (type scale, spacing rhythm, elevation, colour roles, motion) in
`globals.css` + the Tailwind theme *before* touching individual routes — otherwise
each route drifts into its own dialect.

## The money-copy constraint the beauty work inherits

Restyling is not neutral where money is on screen. Any change that alters a label,
a figure's framing, or what a number is adjacent to falls under the `#221`
false-copy rules (`docs/lessons/second-person-copy-scope.md`) and the
`#250` verbatim-value rules
(`docs/lessons/verbatim-value-not-verbatim-meaning.md`): the same number can mean
different things in different cards, and a prettier layout that puts two figures
side by side can imply a relationship the engine never computed. Copy-guardrail
tests must stay green, and any new adjacency of two money figures needs a
rendered-copy test.
