# Decision Log

Record every non-trivial decision made during the build: what, why, alternatives
considered. Append-only.

> Entries #1-#401 live in `docs/archive/DECISIONS_ARCHIVE_1_to_401.md`;
> #402-#484 live in `docs/archive/DECISIONS_ARCHIVE_402_to_484.md`
> (rotated 2026-08-28, same current-wave cut as PROGRESS/REGRESSION).
> #485-#723 live in `docs/archive/DECISIONS_ARCHIVE_485_to_723.md` (rotated 2026-09-11);
> #724-#736 live in `docs/archive/DECISIONS_ARCHIVE_724_to_736.md` (rotated 2026-09-16);
> #737-#739 live in `docs/archive/DECISIONS_ARCHIVE_737_to_739.md` (rotated 2026-09-17);
> #740-#741 live in `docs/archive/DECISIONS_ARCHIVE_740_to_741.md` (rotated 2026-09-17);
> #742-#748 live in `docs/archive/DECISIONS_ARCHIVE_742_to_748.md` (rotated 2026-09-19).
> Only entries #749 onward live here; append new entries as before — the numbering
> never resets, the archives hold the lower numbers.

## #780 — SimpleFIN is retired as a way to connect; everything already connected through it stays (2026-10-02)

*(#779 is held by the compact register row, built on branch `uiux-pass` and waiting at the human gate — not on `main`. This entry takes the next number so that slice does not have to renumber.)*

**Context.** SimpleFIN was the bridge to live bank data while Plaid production access was pending. Plaid is live. The owner, 2026-10-02: "Simplefin was just a bridge until we can get plaid. We have plaid now. I don't mind getting rid of simplefin if we don't break stuff." Checked against production first (read-only): no `SimpleFinConnection` row exists; 12 Plaid items synced that day with no error; 24 `provider = 'simplefin'` accounts remain, every one joined to a Plaid successor by a confirmed reconciliation; 1,357 transactions and 57 holdings came in through SimpleFIN. So nothing depends on a SimpleFIN connection today — but months of stored history do depend on SimpleFIN ROWS.

**Decision.** Retire it as a way IN, and only that.
1. **Nothing offers a new SimpleFIN connection.** The "+ Connect a bank (SimpleFIN)" door and its setup-token form are gone from the Accounts page and from the first-run panel (which every empty page reuses). A reader who never used SimpleFIN now sees no trace of it; the Settings connections card no longer names it. The owner's own Accounts page was showing that first-time door, because all 24 of his SimpleFIN accounts are superseded.
2. **An existing connection is untouched.** Its panel on Accounts (freshness, history depth, Sync now, Disconnect), the sync code, the auto-sync, and the dashboard alert that repairs a failing connection (including pasting a fresh token) all stay. `connectSimplefin` stays as a server action because that repair path calls it.
3. **Accounts that outlived their connection are still told so** (K.2b). The notice keeps its facts — the connection is gone, how many accounts, when the data stopped, that saved transactions are kept — and instead of "Reconnect below" says SimpleFIN is no longer offered and points at the Plaid button directly under it.
4. **No stored row, column, table or read path changes.** No schema change, no migration, no data script. The privacy policy still names SimpleFIN: it describes how a SimpleFIN access URL is stored and who the data is shared with, which stays true for any connection that exists.

**Not done, deliberately.** Deleting the provider module, the sync engine, the `SimpleFinConnection` table or the `provider = 'simplefin'` branches across forty-odd engine files. Each of those reads stored rows; removing them is the "break stuff" the owner asked to avoid, for no reader-visible gain. Two historical live-check scripts (`h5-`, `k2b-live-deploy-check.mjs`) still look for the removed button; they describe past deploys and are left as written.

**A consequence to know.** In an environment with no Plaid credentials, the only ways to get data in are now CSV import and manual accounts. Demo mode is unaffected (rule 4): it never used either provider.

**Critic (separate context, Sonnet): PASS — zero P0/P1.** It seeded every state on its own server — a live connection, stranded accounts, partly and wholly superseded accounts, a failing connection — and found no remaining offer anywhere in the app except the privacy policy. Its P2s, taken: Disconnect became one-way without saying so (the connected panel now says it is final, before it is pressed); the privacy policy named SimpleFIN as a current way to connect (it now names it only for connections made before the retirement; last-updated 2026-10-02). Recorded, not taken: the stranded-accounts notice stays up after the bank is re-linked through Plaid until the old rows are combined or deleted (unverified on screen — no Plaid credentials in the test environment); `docs/SIMPLEFIN_WALKTHROUGH.md` is still a connect walkthrough, linked from nothing.

**Locked.** `tests/unit/simplefin-retired.test.ts` — both halves: nothing offers it; what an existing reader depends on is still there. `tests/e2e/connection-health.spec.ts` (a reader who never used it sees no trace on Accounts and is offered Plaid; stranded accounts get the notice, no SimpleFIN door, and the Plaid button below it), `guided-onboarding.spec.ts` (first-run offers Plaid, CSV and manual, and never SimpleFIN), `transactions.spec.ts`.

## #779 — The compact register row: two lines until it is opened, every control one tap away (2026-10-02)

**Context.** The owner sent a screenshot of Activity on his own account, taken on his iPhone hours after #778 shipped: two full rows and the top of a third filled the screen. A real-account row carries about eighteen controls and labels — Filter, Pending, Details, Bank text, Rule…, the class, the provenance, a suggestion and its Confirm, category, date, account, Note, Tax tag, Exclude, Reimburse, Tag, the amount, a Money in/out flip and ⋯ — most of them 44px tap targets, wrapped into the ~175px left of the amount. Measured on a signed-up test account: **300–350px a row, two rows per screen.** #778's audit ranked this twelfth because it only ever opened the demo, which renders none of the edit controls. Every one of those controls was asked for by name as something to have *on the row*, so the choice was put to the owner with three mock-ups; he chose "compact, opens in place".

**Decision.**
1. **Below `sm`, a row is closed until its chevron opens it.** Closed, it shows what a reader scans for and what says something is waiting: payee, amount, category, date, account, the Fixed/Discretionary label (the page lead promises one on every row), and the chips that are facts or asks — Pending, the handover marker, Excluded from totals, Awaiting reimbursement / Reimbursed, tags, the note/tax control when the row has a note or a tax class (it reads the tax class, or the one word "Note" — the closed row says a note exists, not what it says; the text is one tap in), the one provenance badge that needs an OK ("AI guess") with its Confirm, and a suggestion with its Confirm. A badge that only reports how the category was reached waits for the open — including "Needs a category", because the category chip under it already reads "Uncategorized". Open, it shows every control it had. From `sm` up nothing changes and there is no chevron.
1a. **On a phone the row is a grid, not "controls beside the amount".** Chevron in its own narrow column at the left (first in the DOM, so Tab from it lands in the row it opened); payee and amount on the first line; chips, the category line, and — open — the Money in/out flip and ⋯ on lines that span the full content width. The desktop wrappers go `display: contents` below `sm` so one DOM serves both layouts. The two pickers open from the row's left edge so a 288px panel fits a 360px phone.
2. **Hidden with CSS, not unmounted.** One class (`ROW_REST`) on each control that waits for the open; a `data-open` attribute on the row. Every control stays mounted with its state and test id, desktop renders the row it always did, and nothing about a control depends on whether its row is open.
3. **One Set for the list**, like the three menu controllers already there — no hook per row. Whether a row is open is ONLY that Set (plus the harness's all-open flag). The one panel that can be opened from a closed row — note/tax, on a row that has either — puts the row in the Set as it opens, so the row stays open after the panel is dismissed; and the chevron closes a row's panels with it. (The first two cuts derived "open" from the panel being up; see cycle 2.)
4. **Open rows survive the reload every edit ends in** (`register-open-rows.ts`, sessionStorage — a place in a task, not a preference). They are restored in a LAYOUT effect that writes `data-open` on the DOM itself before telling React: `RegisterScrollRestorer` puts the reader back at an offset that was measured with those rows open, in a passive effect that runs before a state-only restore would re-render. Reopening after the scroll moves the reader's place by every reopened row above it, and Safari has no scroll anchoring to absorb that.
5. **The e2e suite runs with every row open** (`__AIMPLIFI_E2E_OPEN_ROWS`, the Home/Coach chapter precedent): those specs drive controls that now sit behind the chevron. `tests/e2e/activity-row.spec.ts` sets `KEEP_ROWS_CLOSED` and locks what production renders, on a signed-up account with seeded rows.

**Measured after** (same fixture, eight rows, the Playwright touch profiles — Pixel 5 at 380px and iPhone 13 at 390px): closed rows 85–129px, mean 103px — **about 7½ rows on an 800px screen, 6½ on an iPhone 13's 664px** (was two). Those closed heights belong to this fixture: a row carrying two tags, a reimbursement chip and a note closes at about 155px (critic, cycle 2). Opened, against the same eight rows at the commit before (`ca40f713`), measured the same day:

| Width | Opened row, after | The same row, before |
|---|---|---|
| 360px | 226–292px; the long-note row 336px | 302–399px; the long-note row 376px |
| 380px (Chromium) | 226–267px; long-note 320px | 302–353px; long-note 328px |
| 390px (WebKit) | 226–267px; long-note 294px | 279–353px; long-note 328px |
| 430px | 226–251px; long-note 294px | 237–287px; long-note 286px |

So an opened row is shorter than the row it replaced in every cell but one: the row with a 34-character note at 430px is 8px TALLER (294 against 286), because before this slice its note controls ran out past their column on one line and now they wrap inside the screen. (An earlier version of this entry gave "165–208px in Chromium". That was a desktop pointer profile, where tap targets are not padded to 44px — not what a phone renders. Withdrawn.)

**Critic cycle 1 (separate context, Fable): FAIL — 1 P1.** The first cut kept the old flex row and put the chevron in its right-hand column, beside the amount. That took ~48px from the content column, and an OPEN row came out 15–20% taller than the pre-slice row — while this entry, STATUS and TASKS all said "the row as it was". The critic measured it by hiding the chevron; the maker had measured only closed rows. The grid in 1a is the fix, and it is the reflow this entry had deferred as too much for one slice. Its P2s, taken: the chevron came after the content it disclosed (now first); a comment claimed "Needs a category" stays on the closed row when the code hides it (comment corrected, reason given); a closed row hid that it carried a note or tax tag (the control now stays when it has one); the closed layout was verified in Chromium only (the spec now also runs in the `mobile-webkit` project); a storage write sat inside a state updater. Accepted: rows reopen at hydration, a few hundred ms after first paint (the scroll restore has the same property and the order between the two is the part that matters).

**Critic cycle 2 (separate context, Fable): FAIL — 3 P1.** All three were on rows the fixture did not have. (F1) The Note / Tax tag / Exclude / Reimburse group was one unbreakable box; with a note past ~20 characters it left the screen by 57–105px — the spec's only note was 15 characters. On a phone the group is now `display: contents`, so its controls wrap with the line, and they start a line of their own. (F2) "Open" was derived from the note/tax panel being up. Tapping any control the open had revealed dismissed the panel (a press outside it), which closed the row and hid the control before the tap landed: the first tap after opening a panel from a closed row did nothing. Decision 3 is the fix. (F3) The inline amount editor sat in the grid's third (`auto`) column and took the whole row — the payee crushed under it, the Money in/out flip outside the card. While its form is up the amount takes a full line of its own. The spec's note is now 34 characters, and it locks all three, at 360px, the project width and 430px. P2s taken: this entry said a closed row shows the note (it shows the word "Note" — corrected in decision 1); the Chromium heights above were from the wrong pointer profile (re-measured, table above); STATUS reported a full e2e run as green that had ended exit 1 on a force-killed worker (recorded as it happened). P2s accepted, recorded so the next reader does not rediscover them: the amount is on the first line on screen but late in the tab order (the DOM order is desktop's, and reordering it for phones would change desktop's); a note/tax panel that opens upward can cover its own row's chevron until it is dismissed.

**Critic cycle 3 (separate context, Fable): FAIL — 3 P1.** It reproduced every cell of the table above in both engines, then found three defects that predate this slice and that this slice's own sentences now covered ("open: every control", "open rows survive the reload without moving the reader's place"). (F1) The "Bank text" editor sat in a `shrink-0` wrapper at its form's natural width: Save and Cancel were 56–125px off the screen on every row, both engines. On a phone the wrapper may now shrink, and takes a full line while the editor is up. (F2) The account editor's `<select>` is as wide as its longest option; with a 56-character account name (a bank's official names are that long) it was 463–469px on every row. Fixed for every dropdown in the app by one base rule in `globals.css` — `select { max-width: 100%; white-space: normal }`. The second half is for Safari, found by the maker's own sweep after the first half: with the box clamped, WebKit still counted the SELECTED long name toward the page's scroll width (its default for a select is `white-space: pre`) — 89–159px in the row editor, and 227–262px on Activity with that account chosen in the filter bar, which is #778's fold, already live. (F3) The ten row editors — note, tax tag, amount, date, account, bank text, payee, direction, exclude, reimbursement — each confirmed with a bare `window.location.reload()`. Only the row's menus used `reloadPreservingScroll`. So an inline edit brought the row back open and the reader back somewhere else: 3,300px away in Chromium, every time. This is the owner's 2026-08-03 complaint ("bring me to the top … when I'm trying to log many at a time"), fixed then for the menus and never for the editors; decision 4 claimed it handled. All ten call `reloadPreservingScroll` now, a unit test fails if a form the row imports reloads any other way, and the browser test presses a real Save instead of writing the storage key by hand (which is why the old test could not see it).

What "has not moved" means, precisely: the scroll offset is restored. An edit that changes what is above the row moves the row with it — changing a date re-sorts the row to its new day, and excluding a row adds a line to the totals above the list (measured: 16px).

Its P2s, taken: a long payee was hard-clipped with no ellipsis (the rename button now carries the truncation); `aria-controls` on the chevron named the row the button itself sits in (removed — `aria-expanded` is the state); the amount editor was locked at one width (now three); the ledgers' "each a 44px tap target" was loose (seven of the row's text controls are 15–16px tall, as before this slice). Accepted, and written here so they are not rediscovered: a tap on the chevron in the first few hundred milliseconds after the page paints is dropped, like any button before hydration — and the chevron is now the only way into a row; an opened row prints a tax class twice (the Tax tag control and the note/tax trigger), as the old row did; closing a row hides an editor that is mid-edit without discarding it (the draft is there on reopening).

Found by the same sweep and NOT in this slice: at 640–~900px wide (`sm` and up, where the compact row does not apply) a real-account row is 250–350px tall, exactly as before — TASKS U.1k.

**Critic cycle 4 (separate context, Fable): FAIL — 1 P1. Budget exhausted; human gate.** Cycle 3's three held under a much larger attack (sixty rows, a 10,000px list, all ten editors saved for real in both engines: the reader's row came back at the same pixel in 23 of 24 runs, the 24th being the date change that re-sorts it; the height table reproduced cell for cell; the base `select` rule changed no dropdown's width, height or position on 21 routes). The P1 was this slice's own: cycle 2 made the Note / Tax tag / Exclude / Reimburse group `display: contents` so it could not overflow, which turned the note editor into a full-width form whose text box (`flex: 1 1 0%`) got whatever Save, Clear and Cancel left on the line — 53px at 360px, 83px on an iPhone 13, "Co-" / "pay," for a 36-character note. The lock asserted only that nothing left the screen, and a 53px box does not. **Fixed after the cycle, and unreviewed:** on a phone the text field of the note, tax-tag and bank-text editors takes a line of its own (`max-sm:basis-full`, in the form, so Home and the detail page get it too), and the spec asserts the field spans more than 60% of the row's content column at three widths, on a row that has a note (so Clear is in the picture). Its P2s, taken: the payee's rename input was clipped by the payee's own truncating span, 10–82px of it (the span stops clipping while the editor is up, and on a phone the input takes the column's width); the open-rows list was capped at 30 in live state, so opening a 31st row closed the first and, with no scroll anchoring, moved the page 142–158px (the cap is now a storage bound of 500); three "Locked" phrases said more than their tests (below). Recorded, not taken: Home's recent-activity note editor overflows a phone by 56–74px (older than this slice, another page — TASKS U.1l); with sessionStorage blocked a save lands at the top with the row closed; "Note" and "Tax tag" sit closer together than the controls after them.

**Alternatives considered.** Reflow only (every control visible, full-width) — the tap-target floor, not the column width, is what makes a fully-populated row tall; it would have been about three rows per screen. Everything in the ⋯ menu — the shortest list, but every edit costs a menu or a page change, and the owner's workflow is logging many at a time. Conditional rendering instead of CSS — would unmount controls mid-edit and make their test ids depend on row state. Opening on a tap anywhere in the row — the row is full of controls of its own. The chevron at the right, as in the mock-up the owner chose — it has to come before the content in the DOM for the keyboard, and a control that is first in the tab order and last on screen is its own defect; the left is also where the app's other disclosures put theirs.

**Locked.** `tests/e2e/activity-row.spec.ts`, on a signed-up account with rows kept closed, in Chromium AND WebKit: heights and rows-per-screen; what is kept and what waits (including the Excluded and Awaiting-reimbursement chips and a note); the chevron first and 44px; open in place, the chips line at >70% of the row's width and the open row under 270px; Tab stays in the opened row; the chevron closes an open action menu with the row; a panel opened from a closed row opens the row durably, stays inside the viewport, and the next tap on a revealed control lands; no overflow with a 34-character note, with the note editor open (and its text box over 60% of the content column), with the amount editor open (editor and flip inside the row, payee not covered), with the Bank text editor open (same width rule), with the payee's rename box open (painted whole, inside the row), and with the account editor open beside a 56-character account name — idle, selected, and chosen in the filter bar — each at 360px / project width / 430px; every opened row shorter than its pre-slice height at the project widths; a note typed and saved with its own Save button leaves the row open and at the same offset; survives reload both ways; the scroll-order test with scroll anchoring disabled (with the DOM write removed the reader's row lands 870px from where it was); from `sm` up there is no chevron and nothing is hidden (that is all the test asserts — desktop row HEIGHTS were compared by hand against `ca40f713` on a real account, identical at 640 and 1280px, and are not locked); the needs-your-OK row keeps its badge and Confirm closed (the signed-up account's own `llm` row, not the demo's, which another spec confirms away); on the demo, a badge that only reports waits for the open. `tests/unit/register-open-rows.test.ts` (the store, and the fence on the ten row editors' reload). Each of the cycle-2 and cycle-3 fixes was removed once to confirm its test goes red.

## #778 — Usability pass, wave 1: the page's job first, and nothing broken to fit (2026-10-02)

*(#777 is held by the Ask-analyst slice, unshipped in the main checkout — its test and edge-case files already carry the number. This entry takes the next one so that slice does not have to renumber.)*

**Context.** The owner asked for "a ui / ux pass" to "make the app user friendly and intuitive". TASKS U.1 had filed that as an audit whose plan the owner approves before code moves. The audit was done first (`docs/UX_AUDIT_2026-10-02.md`: every route screenshotted at 380px and 1280px on the demo, a first-run walk on a new account, the changed screens re-checked in WebKit) and split in two: defects and idiom fixes that are reversible and change no figure ship now, under the direct ask; changes that move things a reader has learned (the phone tab bar, what an Activity row shows) stay proposals in the audit.

**Decision.**
1. **Activity's secondary filters fold behind one "Filters" control below `sm`.** At 380px they wrapped to five rows ahead of the first transaction. The bar opens itself when one of the folded axes is narrowing the set, because the page lead says "the controls below say which"; the toggle carries the count either way. From `sm` up the wrapper is `display: contents` and the bar is unchanged.
2. **Content is not broken to fit a column.** Forecast milestones are one row each below `md` (three tiles left ~86px at 380px — and again at 640px, where the sidebar appears — and `break-words` split the balance itself); register account names use `overflow-wrap: anywhere` instead of `break-all`.
3. **Whatever opens shows that it opens.** Chapter titles are `inline` so they share a line with the native triangle (which stays — the chapter specs pin it). A flex or grid `<summary>` loses that triangle, so it carries a `DisclosureChevron`; five Coach rests had none.
4. **A pointer is a link to a route — the route where the subject is named.** Four Today-feed sentences ended "Details in Recurring below." and Home renders no Recurring section. The clause is gone from the money sentence and `proposalRouteLink` supplies a link to **/coach**: these rows name no merchant, and Coach's "Worth a look" card renders the very `coach.opportunities` array Home hands the feed, one line per opportunity by name with the row's own figure. The two positional pointers that remain ("above" for cash needed, "below" for the radar) are now pinned to Home's render order by a unit test.
5. **The page's job comes first.** Inbox renders the queue before the accuracy scorecard. Guilt-free folds its three limits under a summary that keeps their shared consequence on the closed line. **Its per-line bases stay open.**
6. **Orientation.** Forecast and Recurring show their `<h1>` (it was `sr-only`); Settings gets an index built from `settings-sections.ts`; Home's read-only recent rows print dates in the app's long form instead of the stored value.

No figure changes and no engine is touched. One sentence is new: the Guilt-free limits summary — "Some repeating bills can go uncounted here — the three notes inside say which — so the real amount free to spend may be lower than shown." It deliberately does **not** restate the three rules: the notes are the one copy of them, and the summary says only that such cases exist, how many notes are inside (a browser test pins the count), and the consequence they already share.

**Critic cycle 1 (separate context, Fable): FAIL — 3 P1.** All three taken. (P1-1) The first cut also folded the per-line bases; two of those sentences are the page's only answer to "where did my card payment go?", two existing specs require them visible, and the closed line carried neither claim — the fold was reverted, not the specs. (P1-2) Two of the new browser tests read the shared demo's triage queue, which `phase2-triage` drains by contract; they now assert on state no other spec moves. (P1-3) The feed link first went to /recurring, which marks only two of the four kinds — "this bill may be negotiable" landed on a dozen unmarked rows; hence /coach above. Its P2s: the limits summary's "running late" was looser than the note's "more than half a cycle overdue" (reworded to the thresholds); two chevron sites hand-rolled the shared class (now use it). Accepted as-is: a tap on the Filters toggle before hydration does nothing — so does every select behind it.

**Critic cycle 2 (fresh context, Fable): FAIL — 1 P1.** The reworded summary ("…without at least three charges at a steady price and rhythm…") put the every-gap rule on yearly bills; `detect.ts` applies it to quarterly and twice-a-year bills only. Two compressions of the same three rules had now each been wrong in a different direction, so the sentence stopped paraphrasing them (above). Its P2s, all taken: three forecast tiles at `sm` let a seven-digit balance cross its tile's border at 640px (three tiles now start at `md`; a test stands a long figure in at 380 and 640); the chevrons ignored `prefers-reduced-motion`; an empty, unfiltered register still offered Filters (hidden there, kept on a filtered-to-empty set); the live probe's header claimed every check discriminates a stale build when three did not (two now do, one is labelled a guard).

**Critic cycle 3 (fresh context, Fable; read-only, its own server and database copy): PASS — 0 P0 / 0 P1 / 4 P2**, all four folded: the summary said "three cases" where the second note holds more than one (now "the three notes inside say which"); the Settings index's docblock claimed render order (it is grouped by purpose, and says so); the Coach link landed at the top of the page with the named list below the fold (it now targets the card, `/coach#worth-a-look`, one constant on both ends); the chevron scan's regex stopped at an arrow handler (it now reads the className value). Critic budget used: 3 of 4.

**Alternatives considered.** Wait for plan approval per U.1 — the owner asked for the pass itself, and everything shipped is reversible and figure-neutral; the parts that are a matter of taste are held back. Naming the merchant in the feed row itself — the right fix, but the payload carries none for these kinds, so it is an engine slice (U.1e). A horizontally scrolling filter strip — fewer taps, but an edge-clipped row is what the owner reported as broken on /accounts. Hiding the native triangle and drawing a chevron on chapters too — the chapter specs forbid removing it, for a reason that still holds. Shrinking the Forecast figure's type until it fits — fits today's demo amounts and breaks again at the next digit.

**Locked.** `tests/e2e/usability-pass.spec.ts` (geometry at 380px: line boxes per figure and per word, title heights, first row above the bottom nav, the fold's default and deep-link states, chevron rotation, every Settings index target, the feed link landing on a Coach list that contains the row's figure). `tests/unit/usability-pass.test.ts` (the feed's pointers against Home's order, Coach and Home reading one opportunities array, the index against the page's anchors, every flex/grid summary carries a chevron). Fail-old evidence and gate output: `docs/STATUS.md`.

## #776 — Golf is a category; a doctor's visit is not food; eye care says eye doctor (2026-09-28)

**Context.** The owner reviewed categories and three filings were wrong in a way that makes the rest of the app untrustworthy: West Pines Golf Club filed as Entertainment & Streaming; a doctor's visit could land in Food & Dining; the category list had no eye doctor or optometrist.

**Decision.**
1. **Golf is its own leaf** (`golf`, Entertainment, discretionary). #109 had parked `\bGOLF\b`, country clubs, driving ranges, and Topgolf on Entertainment & Streaming because no Golf leaf existed, so a golf club read as streaming. Golf Galaxy and PGA Superstore stay Hobbies (retail). A grill or restaurant token still wins, so "Country Club Grill" stays dining.
2. **Doctor and eye care match before a bank food guess can.** `DOCTOR` / `PHYSICIAN` were not in any rule, so "DOCTORS VISIT" fell through to review and a Plaid Food & Dining hint was allowed to file it. Those words now file `doctor`. `EYE DOCTOR`, ophthalmology, and `LENSCRAFTERS` (the old token missed the plural) file `vision`. Plaid primary care maps to `doctor`, not the Health & Pharmacy catch-all.
3. **The eye-care leaf is named "Eye Doctor & Optometrist".** The id stays `vision`. "Vision" and "Doctor's Visit" are picker aliases so the old words and the words people type both find the existing leaf. Ask maps "doctor" and "eye doctor" to those leaves. Ask does not map the bare word "golf": "at top golf" is a store, and a golf synonym answered that one-store question with the whole Golf category (the spend-licence P0).

Already-filed rows are not rewritten. A charge already stored as Entertainment & Streaming or Dining stays until the reader changes it; new charges and anything still in review follow the new rules. No schema change.

**Alternatives considered.** Leave golf on Entertainment (the #109 compromise) — that is the bug the owner reported. A second leaf for optometrist vs eye doctor — same spend, two rows. Matching bare `DR` or `MD` — `MD` is Maryland on a huge share of card descriptors, and `DR PEPPER` is not a physician.

**Locked.** `tests/unit/normalize.test.ts` `test_regression__golf_club_is_golf_and_doctors_visit_is_not_food` (West Pines stays golf even when the provider hint is dining; a doctor's visit stays doctor; eye doctor is vision; a BBQ named Doctor's Orders stays dining). `tests/unit/category-taxonomy.test.ts` `test_regression__eye_doctor_and_golf_are_findable_in_the_right_group`.

## #775 — Free-form tags: the fold at the writer, the total that is not a new number (2026-09-25)

**Context.** O.11d — the last open row of the owner's "add reimbursable and exclude from budgets and all other mint and simplifi fields" ask; it also sits on the O.13b STILL-OPEN transaction-list field list (one slice, two owner complaints). Mint/Simplifi give readers a free-form label set with filtering and a per-tag total; Aimplifi had categories, notes, and the two O.15 flags, but no label the reader invents.

**Decision.** Additive schema: `Tag` (per-user `@@unique([userId, name])`) + an explicit `TransactionTag` join, `onDelete: Cascade` on both edges (the retention document's one-cascade promise). Three load-bearing choices:
1. **The total is not a new number.** The tag total IS `summarizeTransactions` over the tag-filtered rows — the exact function the unfiltered summary strip uses — so the O.15 exclusion rule (figures down, count up), the engine-wide transfer skip, and the U.20 hand-over gate own a tag's total with ZERO tag-specific branches (the L.9 rule: one arithmetic, not two copies). The axis rides `TxnFilter.tag` + one clause in `filterTransactions`; `TxnView.tags` is REQUIRED rather than optional — the same "forgot to select it" failure direction as every other flag on that type — so no read path can filter the axis without having looked tags up (tsc enumerated the construction sites for exactly that reason).
2. **The case fold lives at the writer, not the schema.** `@@unique` is byte-wise and MUST stay so — the reader's capitalization is theirs. `addTransactionTag` matches by lower-cased name and APPLIES the existing tag (race-P2002 re-find uses the winner row), so " Work  TRIP " cannot mint a twin chip; the schema is the last line, not the first: two spellings slipping through a race are two visible chips with real totals, never a hidden wrong figure. Tag naming reuses `categories.ts` verbatim (NFC, invisible-character stripping, the 40-CODE-POINT ceiling) — two normalizers for two label kinds is the L.12c trap.
3. **Fence-by-construction.** `isDemoUser` is checked INSIDE the shared action, not per UI entry point (the #242/L.12c rule — fencing each call site is how the fifth gets missed); the detail view renders the chips read-only plus a reader-facing why, so the fence is an explanation on screen, not a dead button.

**Alternatives considered.** A case-insensitive unique index (Postgres expression / SQLite LIKE trick) — SQLite is a first-class environment and a fold that exists on one engine but not the other is precisely the drift this file exists to prevent. A JSON label column on `Transaction` — no per-user vocabulary, no stable filter id, no cascade. A tag-total engine module — rejected at the design gate: a second arithmetic for one question. A per-row register tag popover — deferred (scope discipline): the editor lives on the detail view beside the note/receipts (the three answers to "what was this?"), and a future popover passes the same action fence automatically.

**Locked.** `tests/unit/txn-tags.test.ts` (12: naming incl. the CJK/emoji code-point cap, locale-independent sort, axis composition with `type`/`account`/`unclassified`, and the hand-verified totals — transfer never counts, the excluded row stays listed but leaves the figures), `tests/unit/txn-tags-actions.test.ts` (6: the fold reuses rather than mints, empty/over-long refuse and write nothing, a foreign row is not-found-not-described, a foreign tagId removes nothing, the demo fence refuses both verbs), `tests/unit/seed.test.ts` › tags (counts, referential integrity, no transfer tagged, and every seeded name passes the LIVE `validateTagName` — the seed is written BY the rules, not beside them), e2e `tests/e2e/txn-tags.spec.ts` (throwaway-signup write flows where the register's Money out reads exactly $65.00 on a tag-filtered set that CONTAINS a −$10.00 transfer — the shared basis on a live screen; the `(tag not found)` mirror AND the dedicated `txn-empty-tag-unknown` empty state for a foreign `?tag=`; the demo READ-ONLY read of the seeded tags, with the fence's why asserted on the TAGGED row). EDGE_CASES: `tests/edge-cases/tags-tag-axis-and-total-o-11d.md` (hand-verified fixture). Seed: `SEED_SPEC §Tags` — 2 tags / 6 assignments, PRNG-free deterministic selection so every golden figure is byte-identical. Follow-ups recorded open: tag rename/delete-tag surfaces, and a register-side quick-add popover (both post-decision scope).

**Critic (fresh verifier context; it independently re-ran tsc, eslint, the FULL vitest — 8633 passed — and the build before scoring): PASS — 0 P0 / 0 P1 / 6 P2.** Folded in the same session: (1) the `tagFilter` comment promised an empty state that did not exist → the REAL parity shipped instead (`registerEmptyReason` grew the `tag-unknown` branch beside `account-unknown`, page passes `tagFilter`, renderer names the cause with its own "Show all transactions" way out, engine lock added); (2) the demo fence's why now renders on EVERY demo row — the seeded rows are the tagged ones a first visitor opens; (3) `rateLimitDurable` guards the one row-creating verb (40 names/min — the fold's read and three tables stay flood-proof, closing the gap my own test-mock exposed); (4) the input's `maxLength` is 2× the code-point cap (the browser counts UTF-16 units; the server check stays the authority); (5) the cap sentence states the true bound ("to 40", not "under 40" — a 40-code-point name is VALID; the sibling validators' "under N" wording is a family-wide copy sweep, recorded open); (6) the 40-char-chip-at-380px case stays untested-by-pin (the whole e2e suite runs at 380px with real chips; recorded open).

## #774 — The reimbursement round trip: the payback counts on neither side (2026-09-25)

**Context.** O.11c, the one open money-correctness piece of the owner's O.11 ask. A positive row filed to the `reimbursement` leaf counted as INCOME in `isIncomeFlowRow` (#166 admitted every Income-group leaf but `refund`), while the O.15 tracker + the `excludeFromTotals` lever take the outflow OUT of the flow figures — so the owner's exact use case (exclude the work expense; Concur pays it back; the categorizer AUTO-FILES the payback via `normalize.ts:354`) fabricated phantom income on every shared-predicate surface: the reports chart, the glass-box panel, /coach savings rate, Ask income + savings answers, the creep income baseline, the spending-plan fallback. #166's own rationale — "they aren't offsets of a tracked purchase" — is precisely false once the row IS tracked, which is what the leaf exists for.

**Decision.** A POSITIVE row categorized `reimbursement` counts on NEITHER side: it is skipped entirely from `monthlyFlows` and from the glass-box month-flow panel via ONE shared predicate, `isReimbursementInflow` (`insights.ts`), consumed by both stores so they cannot drift. Deliberately NOT a mirror of `refund`: a netting payback would UNDERSTATE real spending whenever the outflow was itself excluded — the too-generous direction — because the excluded outflow never entered the expense pool. The composition is the point: exclusion lever + carve-out = net 0 = the cash truth for a fully reimbursed expense. The tracker stays suggestion-only (no figure depends on a match). `refund`'s spend-netting is untouched; `tax-refund` still counts as income (#166's other halves preserved). Categorization is the lever: the same deposit filed `uncategorized` or unfiled still counts as income (O.20c doctrine — the category IS the reader's assertion); filed `refund` it nets. Sign-gated: an OUTFLOW filed `reimbursement` is still spending. No schema change; the demo seed holds zero reimbursement rows (verified), so demo figures are byte-identical.

**Locked.** `tests/unit/insights.test.ts` › `the reimbursement round trip` (5 cases incl. the excluded-round-trip floor pin and the sign gate), `tests/unit/month-flow-breakdown.test.ts` (`test_regression__o11c_reimbursement_payback_sits_in_neither_panel` + the dated-ahead notCountedYet pin + basis-sentence locks), `tests/unit/income-pattern.test.ts` (the fallback refuses it), `tests/unit/spend-class.test.ts` (`test_regression__o11c_the_money_in_explanation_stops_claiming_income`), and the Income-group canary updated to name both carve-outs. Fail-old **7 failed | 92 passed**. Live sizing probe `scripts/audit-probes/o11c-reimbursement-income.mts` (read-only): 0 reimbursement inflows corpus-wide today — prevention, not a live-figure repair. EDGE_CASES index + hand-verified matrix: `tests/edge-cases/reimbursement-round-trip-o-11c-engine-fi-insights.md`.

**Critic (fresh context): cycle 1 FAIL — 1 P1 + 5 P2; the P1 + 3 P2 folded the same session.** The P1: the `money-in` spend-class chip still told the reader "It still counts as income" on exactly the rows this slice reclassified (and, since #166, on `refund` rows too) — rendered in the register chrome and the detail page, on a population the categorizer files itself. Folded with the cycle-2 critic's delta P2s: the coach outstanding card's "until the money comes back" promise (nothing removed spending on receipt — the exclusion lever does) and its detail-view sibling now name the exclusion as the mechanism; the `categories.ts` comment states both carve-outs; the round-trip matrix got its EDGE_CASES section (and the O.20g file's now-stale predicate sentence was corrected in the same pass). **Cycle 2 PASS — 0 P0 / 0 P1 / 3 delta P2**, all three folded or satisfied by these ledger writes.

**Residual.** Two P2s recorded in STATUS, deliberately open: the non-excluded round trip strands the purchase in spending with no surface explaining why (the conservative direction; disclosure design work), and the Ask income answer enumerates less than its own trace line.

## #773 — Dining rule matches Grille; the owner's inbox revives on read (2026-09-24)

**Context.** L.12(c), the last open code piece of the owner's loudest competitive complaint ("321 inbox items… Simplifi deals with 90% of them well, ours is awful by comparison"): his screenshot's "Goose Pond Bar Grille" (8 txns) showed "Suggestion: none yet". Root cause verified at source: the generic dining keyword rule used `\bGRILL\b`, which cannot match GRILLE — no word boundary before the trailing -e. #303 already ships the persisted Plaid guess + fallback suggestion, and MEDIUM PFC (7200 bps) already auto-files in the [7000, 9000) band with the visible AI badge, so (d)'s substance was already in.

**Decision.** Widen the one token: `\bGRILL\b` → `GRILLE?S?` (covers GRILL/GRILLE/GRILLS/GRILLES; the surrounding `\b` still excludes GRILLED and GRILLWORKS, which stay in review — the safe direction). No other rule touched, no schema change. Because triage re-runs `categorize()` per row on read (`src/server/triage.ts:140`/`:329`), the fix revives suggestions on rows ALREADY in the owner's queue — no data backfill; the O.12d repair route separately backfills provider hints on pre-L.12 rows. Two #303 fixtures seeded the owner's descriptor as "a merchant our ruleset misses", which the widening falsified: the plaid-map unit fixture moved to GOOSE POND HIDEAWAY (verified true miss by execution) and the e2e became a two-ladder spec — provider fallback on the true miss, our own confident one-tap on the owner's merchant. Every locked behavior stays on a fixture that still exercises it.

**Locked.** `tests/unit/normalize.test.ts` (4 generic cases + `test_regression__l12c_grille_dining_boundary` through the public `categorize()` path; fail-old **4 failed | 115 passed**); `tests/unit/plaid-map.test.ts` (LOW-PFC→review+persisted-guess on a true miss); `tests/e2e/triage-provider-suggestion.spec.ts` 2/2 (both ladders, mobile-380); `tests/e2e/triage-write-in.spec.ts` 2/2 — CI run 36059727655 (the full local gate skips e2e) caught that spec's built-in tripwire ("if the ruleset ever learns one of these merchants, this fails HERE") firing on its seeded `GOOSE POND BAR GRILLE` top group; the seed moved to the verified true miss `GOOSE POND HIDEAWAY` with the tripwire's cause documented. `npm run eval:categorize` byte-identical pre/post (**480 | 59 | 421 | 410 | 11 | 97.4%** — the corpora hold zero GRILLE/GRILLS tokens, so identity is structural).

**Critic (fresh context): cycle 4 PASS — 0 P0 / 0 P1 / 3 P2.** Financial correctness 9, security 10, UX 9, mobile 9, a11y 8, performance 8, code quality 9, coverage 8. P2-1: SUNCO CUSTOM GRILLE / BMW GRILLE REPLACEMENT / GRILLE WORKS CONTRACTORS confidently auto-file dining (adversarially-loaded probe re-run byte-identical by the critic; measured harm nil on the corpora; visible + one-tap re-filable; the reverse failure was the reported defect). P2-2: the GRILLS plural is newly matched but unpinned by any test. P2-3: the e2e's third suggestion rung (proposal) coverage surviving the rewrite is maker-asserted. Cycles 1–3 each reproduced gates (cycle 2 re-ran the FULL verify green) but were cut off before emitting a verdict; cycle 4 delivered.

**Residual.** (d)'s live-corpus before/after auto-file coverage remains UNVERIFIED (needs the owner's Plaid corpus).

## #772 — Month-rest names Monthly Money Review the way the card does (2026-09-22)

**Context.** #771 critic P2-1: the closed rest ended “the monthly review” while the card’s label is “Monthly Money Review”. Owner: name the monthly review the way the card does, if that polish is the next slice.

**Decision.** The closed summary ends with the card’s words, `Monthly Money Review`. One exported string is both the `CardDescription` and the last clause of `monthRestSummary`. The list’s “and” is the conjunction, not part of the name. No schema change. Peer titles that are still a lowercased paraphrase stay as recorded residuals.

**Locked.** `tests/unit/month-rest-summary.test.ts` (eight sentences end “and Monthly Money Review”; `test_regression__month_rest_names_the_review_the_way_the_card_does`). `tests/e2e/coach-chapters.spec.ts` (demo summary is that full sentence).

**Critic (fresh context): PASS UX 9 / 0 P0 / 0 P1 / 3 P2.** Mobile 8, a11y 8, code quality 9, coverage 8. P2s recorded, not closed: the e2e still locks only the all-present sentence; the other rest titles are still hand-copied with case and article drift; the review lock is a source grep.

## #771 — Month-rest names the life-energy view from the card gates (2026-09-22)

**Context.** #770 critic P2-2: the always-on purchases card was named “hours”, the toggle word, not the label on the card (“Life-energy view”). P2-1: the three presence flags were written again beside the card null-gates. Owner: continue.

**Decision.** The always-on claim is “life-energy view”. “life energy by category” stays the fulfillment card, named only when that card renders. `showsAutomationBlueprint`, `showsFulfillment`, and `showsValueReceipts` are the null-gates the cards and the summary both call. `showsFulfillment` is a type predicate so the curve stays readable after the gate. No schema change.

**Locked.** `tests/unit/month-rest-summary.test.ts` (eight sentences; life-energy view and no “hours”; the three predicates match empty/null/zero). `tests/unit/coach-chapters.test.ts` (page calls the shared predicates). `tests/e2e/coach-chapters.spec.ts` (demo summary is the full sentence with life-energy view).

**Critic (fresh context): PASS UX 8 / 0 P0 / 0 P1 / 4 P2.** P2s recorded, not closed: summary still says “the monthly review” while the card says “Monthly Money Review”; the life-energy phrase is not locked against the card source; the e2e locks only the all-present sentence; the shared-gate lock is a source grep.

## #770 — Month-rest summary names every claim it hides (2026-09-21)

**Context.** #769 critic P2-1: `coach-month-rest` said “Lifestyle creep, room for error, hours, and the monthly review” while the same disclosure also holds the automation blueprint, life energy by category, and what Aimplifi caught. Those three are absent for some readers. Owner: continue.

**Decision.** The summary is composed from what actually renders. Creep, room for error, hours, and the monthly review are always named. “the automation blueprint”, “life energy by category”, and “what Aimplifi caught” are named only when that card is in the disclosure. No schema change. The words match the card titles a reader sees, not the component names.

**Locked.** `tests/unit/month-rest-summary.test.ts` (all eight presence combinations). `tests/unit/coach-chapters.test.ts` (page calls `monthRestSummary` with `blueprint.length > 0`, `fulfillment != null`, and `receipts.total > 0`). `tests/e2e/coach-chapters.spec.ts` (demo summary is the full all-present sentence).

**Critic (fresh context): PASS UX 8 / 0 P0 / 0 P1 / 4 P2.** Same session closed P2-3 and P2-4 (page gates locked; demo e2e locks the full sentence). P2-1 remains: the three booleans are still written next to the card null-gates, not shared with them. P2-2 remains: the always-on life-energy card is still named “hours”, the word the toggle uses, not “Life-energy view”.

## #769 — This month opens on the destination and the flags (2026-09-21)

**Context.** #768 left the extra-dollar why, the assumptions, and the opportunity essays on the open fold. Owner: build it out. The answer was a small title under a redundant kicker, and the flags sat below a goals row.

**Decision.** The headline is the destination at page-title size. The why stays on the fold, and the frozen note stays immediately after it. Skipped rungs, the cards-this-cycle note, and the assumptions start in a closed disclosure whose summary names all three. The merchant flags stay visible, directly under that card; savings goals move below them. What acting on the flags does to the FI date, and the 90-day cash-flow walk when that sentence exists, start closed under a summary that names those claims plus how the amounts were worked out. Empty list still renders no basis. No schema change.

**Locked.** `tests/unit/next-dollar-card-render.test.tsx` (closed more; why outside; frozen note before skipped). `tests/unit/coach-chapters.test.ts` (worked-out closed after the list; all three summary strings; goals after the flags; rest still holds automation, fulfillment, receipts). `tests/e2e/coach-chapters.spec.ts` (380: headline ≥24px, biggest lever finishes ≤800, assumptions hidden until open, summary names FI date, summary ≥44px). `tests/e2e/phase3-coach.spec.ts` opens the disclosure before reading the basis and the FI sentence.

**Critic (fresh context): cycle 1 FAIL UX 5 / 1 P1** (FI/radar claims under a provenance-only summary). **Cycle 2 PASS UX 8 / 0 P0 / 0 P1 / 3 P2.** Same session: P2-2 and P2-3 closed (both-branch string locked; summary says cash-flow walk). P2-1 remains: month-rest summary does not name automation, fulfillment, or receipts.

## #768 — This month’s first fold is the extra dollar and the flags (2026-09-21)

**Context.** #767 left Coach This month open on next-dollar, with opportunity future-value and goals already closed. Creep, hours, runway, and the monthly review still painted in that open chapter. Owner: continue. The named gap to an A was that first fold.

**Decision.** Keep This month open. After next-dollar, the closed goals disclosure, reimbursements, and the opportunity flags, one closed `<details data-testid="coach-month-rest">` holds lifestyle creep, runway, the automation blueprint, life-energy, fulfillment, value receipts, and the monthly review. The summary names room for error, because Ask sends “how many months of runway” to `/coach` and Trajectory (where staying-wealthy also mentions the cushion) starts closed. The chapter lead no longer promises the review on the first fold. No schema change. Specs that read those cards open the disclosure first.

**Locked.** Unit: `coach-chapters.test.ts` — rest tag has no `open`; creep, LifeEnergy, and money-review sit inside it, after opportunities. Playwright: `coach-chapters.spec.ts` — first fold shows next-dollar and opportunities; creep, life-energy, and the review stay hidden until the summary opens.

## #767 — UX A-grade: stage money, named destinations, one filing story (2026-09-21)

**Context.** Live adversarial review scored C / 5.1. Owner: get closer to A, do not stop. P1s: cash-needed 14px, synonym nav rows, Plan vs Spending, Inbox vs “17”, Today restates the hero, Coach first-fold essays, category dumps, sign-in void.

**Decision.** Keep routes. Rename Plan → Guilt-free, Spending → Budgets. Keep two filing queues; Home chip says “N to file on Activity.” Home Today display-filters `payment_due` and unfrozen `cash_needed_shortfall` (push unchanged; frozen shortfall stays for L.20). Coach This month opens on next-dollar; household moves to Habits; opportunity FV and goals start closed. Category managers on Inbox/Budgets/Rules start in a closed disclosure. Sign-in leads with Explore the demo (primary). Stage money: `amountClassName` on the amount button; CardTitle skips `text-sm` when the class is `text-3xl`/`text-4xl`. Ask in the phone header and desktop Daily. No schema change.

**Locked.** Units: `home-today.test.ts`, `ux-a-grade-locks.test.ts`, page-chrome token-on-button, home-needs-file / inbox-copy / coach-chapters / nav-destinations / desktop-sidebar / demo-sign-in. Playwright: home-stage ≥28px; Today has no `nudge-payment_due`; desktop Trends is a label + title.

## #766 — Clear chapter hold on the next pointerdown (2026-09-21)

**Context.** #765 P2-4 / P2-5: first click-open did not arm hold, so a late ghost click could native-close; the 500ms Enter hold could swallow a real close. Owner: continue.

**Decision.** Arm `holdOpen` on first click-open (and Space/Enter/adopt). After ready, `pointerdown` clears the hold so a real tap/click can close. Keydown while hold && ready also clears and allows native close. Keep the 500ms fallback. Do not assign `el.open = false`. No schema change. RSC payload, harness auto-open, unit greps, pointer-shaped leftovers, and M.4 restyle stay residual.

**Locked.** Units: `clearHoldOpen`, `onPointerDown`. Playwright: tap-open then `HTMLElement.click()` stays `open &&` card; first-open Enter then Playwright click closes.

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.**

## #765 — Hold first chapter open through the leftover click (2026-09-20)

**Context.** #764 P2-4 / P2-2: after `adopt()`/`flushSync` set `readyRef`, the same gesture's leftover click (Enter's synthesized click, or a UA that already toggled `open`) native-closed the chapter. Owner: continue.

**Decision.** `holdOpenRef` arms on `adopt()` and on first-open Enter. While armed, summary click/keydown `preventDefault`s so that leftover activation cannot close. Do not arm on first click-open (a second tap must still close). Do not assign `el.open = false`. 500ms fallback so a forgotten hold does not last forever. No schema change. RSC payload, harness auto-open, unit greps, and M.4 restyle stay residual.

**Locked.** Units: `holdOpenRef`, `armHoldOpen`. Playwright: first-open Enter on Picture/Trajectory stays `open &&` card; programmatic `el.open = true` then trusted `summary.click()` stays open, and the next `click()` closes.

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.** P2-1/P2-2 (untrusted leftover dispatch; close-after missing) closed same-session with `HTMLElement.click()`.

## #764 — UA-first chapter open mounts the body before paint (2026-09-20)

**Context.** #763 P2-1 / P2-5: a UA that set `details.open` first could paint an empty shell; `toggle` attached after paint. Owner: continue.

**Decision.** Watch `open` with `MutationObserver` (microtask, before paint) and keep `toggle` as backup, both in `useLayoutEffect`. `flushSync` mounts children in that turn. Click/Space/Enter `preventDefault` until `readyRef` after the first open is applied. Do not assign `el.open = false` (that crashed the error boundary on #763). No schema change. RSC payload, harness auto-open, first-open Enter e2e, and M.4 restyle stay residual.

**Locked.** Units: `flushSync`, `MutationObserver`, `readyRef`. Playwright: Space first-open + Enter after remount; programmatic `el.open = true` then one microtask is `open && home-plan-figures` / `open && money-rules-card`.

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.**

## #763 — Space/Enter opens a chapter with the body already there (2026-09-20)

**Context.** #762 residual (3): Space/Enter could empty-open if a UA toggled `<details>` before click. Owner: continue.

**Decision.** Summary `onKeyDown` for Space/Enter while unmounted `preventDefault`s and uses the same `pendingOpen` + mount-then-open path as click. `onToggle` on an unmounted open mounts children; it does not assign `el.open = false` (that crashed the app error boundary). `mountedRef` syncs in `useLayoutEffect`. No schema change. RSC payload, harness auto-open, and M.4 restyle stay residual.

**Locked.** Units: `onKeyDown`, `event.key !== ' '`, `mountedRef`, `!el.open || mountedRef.current`. Playwright: Space on Trajectory/Picture is `open && fi-card` / `open && net-worth-amount`; programmatic `el.open = true` on never-opened Habits/Adjust mounts `money-rules-card` / `home-plan-figures`.

**Critic (fresh context): cycle 1 PASS UX 8 / 0 P0 / 0 P1 / 5 P2.**

## #762 — Open chapter bodies before the shell; restore landmark focus rings (2026-09-19)

**Context.** #761 P2s the owner can see: first open painted an empty `<details>` then the cards; nested Coach landmarks hid the land ring with `focus:outline-none`.

**Decision.** First open mounts children, then sets `details.open` in `useLayoutEffect` (`pendingOpen`). First summary click `preventDefault`s while unmounted. Nested Coach landmarks drop `focus:outline-none`. Home clicks parse `new URL(href).hash`. No schema change. RSC payload and M.4 restyle stay residual.

**Locked.** Units: `pendingOpen`, `preventDefault`, landmark tags have no `focus:outline-none`. Playwright: open chapter already contains `fi-card` / `net-worth-amount`; `#coach-money-dials` `outlineStyle !== none`.

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 7 P2.**

## #761 — Mount unread chapter bodies only after first open (2026-09-19)

**Context.** #760 residual (5): closed Home/Coach chapters still committed every card into the first HTML. Owner: continue.

**Decision.** `{mounted ? children : null}` with `useState(defaultOpen)`. First open (toggle, hash, nav, or e2e OPEN without KEEP_*_CLOSED) keeps the body mounted. Coach nested landmarks (`coach-money-dials`, `coach-rich-life`, `coach-employer-match`, `coach-tax-advantaged-room`) reveal the parent chapter so wealth-target / onboarding / Investments jumps still land. Daily loop and Coach This month stay mounted. RSC still serializes children (named residual; not `next/dynamic`). No schema change. M.4 restyle stays owner-gated.

**Locked.** `tests/unit/coach-chapters.test.ts` / `home-chapters.test.ts` (`{mounted ? children : null}`; Habits/Trajectory `landmarks`). Playwright under KEEP_*: closed `fi-card` / `money-rules-card` / `net-worth-amount` / `home-plan-figures` `not.toBeAttached()`; `/coach#coach-money-dials` and `wealth-target-dials-link` open Habits.

**Critic (fresh context): cycle 1 FAIL UX 7 / 1 P1 (nested hashes dead). Cycle 2 PASS UX 9 / 0 P0 / 0 P1 / 7 P2.**

## #760 — Home chapter jump nav, focus on open, valid summary lead (2026-09-19)

**Context.** #759 residuals the owner can use: no Home jump nav; hash/nav open did not move focus; `<p>` inside `<summary>` is outside the HTML summary model; marker locked only by source grep.

**Decision.** After the open daily loop (radar last), a `home-chapter-nav` jumps to Adjust / Picture / Setup. Setup link and chapter share one `showHomeSetup` flag. Hash or `#id` click opens the chapter and focuses it (`tabIndex={-1}`). Leads are a `<span className="mt-1 block…">`. Native `listStyleType` locked in e2e. Focus ring stays visible. No schema change. Coach SSR and M.4 restyle stay residual.

**Locked.** `tests/unit/home-chapters.test.ts` (radar < nav < adjust; `showHomeSetup` used ≥3 times; span lead; `el.focus()`). Playwright `home-chapters.spec.ts` (nav opens Picture, Adjust closed, focused; hash focused; painted `disclosure|disc`). Coach same-hash + focus + marker.

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 5 P2.** P2-1/P2-2 closed same-session (outline kept; one setup flag).

## #759 — Coach chapters: native marker, same-hash re-open, coaching voice (2026-09-19)

**Context.** #757 P2s: Coach summaries hid the disclosure triangle; a second Trajectory tap was a no-op; Trajectory/Habits leads talked about page structure. #758 P2-4: Home hash-open untested.

**Decision.** Restore the native `<details>` marker on Coach (same `ps-4` gutter as Home). A click on `a[href="#id"]` opens that chapter even when the hash does not change. Trajectory: "Your savings rate, FI number, and how the long game is tracking." Habits: "Your money dials, streaks, and the rules that keep the plan going." Home chapters get the same click-to-open. No schema change. Coach SSR and M.4 restyle stay residual.

**Locked.** `tests/unit/coach-chapters.test.ts` (no hide tokens; leads second-person; click href). `tests/e2e/coach-chapters.spec.ts` (Habits closed at 380; same-hash Trajectory re-open). `tests/e2e/home-chapters.spec.ts` (`#home-picture` opens Picture only). `tests/e2e/desktop-header.spec.ts` Plan/Trends described.

**Critic (fresh context): cycle 1 PASS UX 9 / 0 P0 / 0 P1 / 3 P2.**

## #758 — Home chapters: daily loop open, Adjust / Picture / Setup closed (2026-09-19)

**Context.** #757 residual (5): Home below the stage was still a feature dump. Owner: continue (including mobile). Cycle 1 critic FAIL UX 6: Welcome back and alarm-state radar sat inside closed chapters.

**Decision.** After stage + recent + Today + goals + alert banners + onboarding + return-moment + cash-flow radar, unread Home chapters start closed: **Adjust the plan** (plan figures), **The picture** (savings / spending / insights / net worth / export / paw / idle), **Home setup** (deepen + push, only if either exists). Native disclosure marker kept. Alerts and radar stay in the open loop. No schema change.

**Locked.** `tests/unit/home-chapters.test.ts` (source order; banners + return + radar before Adjust; chapters not `defaultOpen`). Playwright `home-chapters.spec.ts` (380: daily loop + radar visible; Picture/Adjust closed until summary click). Harness `__AIMPLIFI_E2E_OPEN_HOME`; collapse spec sets `KEEP_HOME_CLOSED`.

**Critic (fresh context): cycle 1 FAIL UX 6 / 2 P1. Cycle 2 PASS UX 9 / 0 P0 / 0 P1 / 4 P2.** P2s: return vs banners (then banners-first); 4px then `ps-4` gutter; harness auto-open; no hash-nav.

## #757 — Visual IA: grouped sidebar, Home stage, Coach chapters (2026-09-19)

**Context.** Live review of www.aimplifi.app (1280 / 390) scored Craft 6 / Identity 4 / Composition 5 / IA 4 / Mobile 7. Desktop nav wrapped 19 pills; Home dumped the plan form between heroes; Coach was a 7,076px essay. Owner: keep working until the worst critic scores 9.

**Decision.** Desktop: grouped sidebar (Daily / Money / Explore), labels only except Plan / Spending / Reports / Trends (one-line descriptions). Phones: five tabs + More sheet (descriptions + search focus + Tab trap). Home `home-stage`: cash-needed first in the DOM (left on desktop, above on 380); guilt-free is the pair (`MONEY_PAIR_CLASS`); plan form after recent + today. Cash-needed card `size="sm"`; this cycle's dues, forecast/cards links, and assumptions start inside a closed `<details data-testid="cash-needed-dues">` so both amounts finish inside 800px on CI Linux chrome. Trends description starts with "Category movers…" — never "What changed" — so `/trends` `getByText('What changed')` stays unique. Coach: h1 "Coach"; chapters This month / Trajectory / Habits in source order; unread chapters are `<details>` closed (Now `defaultOpen`); goals + household in Now; Rich Life + money rules in Habits. Brand: `BrandMark` + uncolored "Aimplifi"; sign-in real `<h1>`. Money tokens: `MONEY_DISPLAY_CLASS` / `MONEY_PAIR_CLASS` / `MONEY_NEGATIVE_CLASS`. No schema change.

**Locked.** `tests/unit/desktop-sidebar.test.ts`, `tests/unit/coach-chapters.test.ts`, `tests/unit/home-plan-figures.test.ts`, `tests/unit/page-chrome.test.ts`, `tests/unit/demo-sign-in.test.ts`, `tests/unit/nav-destinations.test.ts` (Trends contains `movers`, not `what changed`). Playwright: `home-stage.spec.ts` (380 y-order + dues closed + 1280 x-order), `coach-chapters.spec.ts` (order + 380 collapse), `phase1-cash-needed.spec.ts` (guilt ≤800), `desktop-header.spec.ts`, `mobile-nav.spec.ts` (search focused; Trends `Category movers`). Harness `__AIMPLIFI_E2E_OPEN_COACH` opens chapters for existing Coach specs; collapse spec sets `KEEP_COACH_CLOSED`.

**Critic (fresh context, cycle 3): PASS UX 9 / 0 P0 / 0 P1 / 4 P2.** Cycle 1 FAIL UX 5 (4 P1). Cycle 2 FAIL UX 7 (2 P1: labeled feed; 19 bare nouns). Cycle 3 closed both. P2s: no chapter chevron; same-hash re-click no-op; Trajectory lead voice; Habits/desktop description not e2e-locked.

## #756 — O.20j residual (10): trim sibling plaidItemId === so same-item copies stay two accounts (2026-09-19)

**Context.** #755 critic P2-1: the live-map join trims keys, but `sameIngestConnection`, `accountsOf`, and the `/accounts` card filters still used raw `plaidItemId ===`. A padded vs clean stored item id looked like two connections, so same-item copies folded on last-4 and a genuine transfer could vanish; padded accounts also disappeared from combine.

**Decision.** `samePlaidItemId` trims both sides; empty / whitespace-only is not a match (membership). `sameIngestConnection` treats empty / whitespace after trim as missing (fail-closed: same ingest, block folding). Wired into `accountsOf` and both `/accounts` filters. Live 0977 unchanged. `isTransfer` add-only. H.7b not auto-run. No schema change. Present map value `''`, leftover raw maps / `Set.has`, and `plaid.ts` investment `===` stay residual.

**Locked.** `tests/unit/transfer-pair-identity.test.ts`: padded vs clean same item does not fold; empty / whitespace does not fold; padded same-item transfer still flags+files; `samePlaidItemId` empty-not-a-match; three sites use the helper. `tests/unit/combine-connections.test.ts`: padded account fk and padded stored `itemId` still offer the Chase combine. FAIL-OLD (maker, no helper): **8 failed | 80 skipped**. Critic independently: **6 failed | 82 passed** (restored untrimmed `===` at the three sites; helper left intact).

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r10`): cycle 1 PASS 0 P0 / 0 P1 / 7 P2.** Independently: tsc 0, 88/88, FAIL-OLD 6|82, kill-calls (a) trim-one-side 2|86, (b) empty-equals-empty 1|87, (c) empty-as-different-ingest 1|87. P2s in STATUS.

## #755 — O.20j residual (9): trim live-map keys so a padded stored itemId still joins (2026-09-18)

**Context.** #754 critic P2-1: lookup was trimmed, map keys were raw `itemId`. A padded stored `PlaidItem.itemId` missed `Map.has` and inherited the Account stamp — the #754 inversion.

**Decision.** `liveInstitutionByItem` trims the insert key. Empty / whitespace-only stored ids are not keys. Combine, `/accounts`, and the transfer sweep all call it. Live 0977 unchanged. `isTransfer` add-only. H.7b not auto-run. No schema change. Sibling `plaidItemId ===` and present map value `''` stay residual.

**Locked.** `tests/unit/transfer-pair-identity.test.ts`: padded stored key + clean fk stays present-null; padded stored key still presents `ins_56`; whitespace-only stored id is not a key; three callers use the helper. `tests/unit/combine-connections-server.test.ts`: padded `itemId` + clean fk → `institutionId` null. FAIL-OLD (untrimmed helper): **3 failed | 113 skipped** (maker, filtered); critic independently **4 failed | 1 passed | 111 skipped**.

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r9`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, eslint 0, 116/116, FAIL-OLD 4|1|111, kill-call skip empty-key guard 1 failed. P2s in STATUS.

## #754 — O.20j residual (8): trim plaidItemId before the live institution join (2026-09-18)

**Context.** #753 critic P2-1 / P2-2: `resolveLiveInstitutionField` looked up `plaidItemId` without trimming. A padded id (`" item-a"`) missed `Map.has` and inherited the Account stamp, so a present-null live item looked identified.

**Decision.** Trim the lookup key. Empty / whitespace-only is missing (stamp is last-known). Live 0977 unchanged. `isTransfer` add-only. H.7b not auto-run. No schema change. Map keys and sibling `plaidItemId ===` sites stay untrimmed (this-cycle P2s). Present map value `''` still returns `''`.

**Locked.** `tests/unit/transfer-pair-identity.test.ts`: padded present-null stays null; padded live `ins_56` over null stamp; whitespace-only uses stamp. `tests/unit/combine-connections-server.test.ts`: padded fk + present-null item → `institutionId` null. FAIL-OLD (untrimmed `has`): **3 failed | 108 skipped**.

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r8`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, eslint 0, 111/111, FAIL-OLD 3|108, kill-call value-trim 3 failed. P2s in STATUS.

## #753 — O.20j residual (7): present-null institution name does not inherit the stamp (2026-09-18)

**Context.** #752 critic P2-1: `buildCombineInputs` and `/accounts` `identityOf` still inlined `item?.institution ?? stamp`. A present-null live PlaidItem inherited the account name stamp, so the identity ladder's both-null name fallback could prove SAME and offer an irreversible continue while the live bank is unknown.

**Decision.** Both surfaces call `resolveLiveInstitutionName` (same `Map.has` join as the id helper, shared `resolveLiveInstitutionField`). Present null stays null; missing item still uses the stamp (disconnect). Live 0977 (`ins_56` over a null stamp) is unchanged. `isTransfer` add-only. H.7b not auto-run. No schema change. Whitespace / empty-string `plaidItemId` stays residual (this-cycle P2-1/P2-2).

**Locked.** `tests/unit/combine-connections-server.test.ts`: present-null + stale name stamp → `engineAccounts[0].institutionName` null; missing item → stamp; live Chase over null stamp; `getAccountsView` present-null live name + matching stamps after disconnect → `reconciliationCandidates []`. `tests/unit/transfer-pair-identity.test.ts`: both files call `resolveLiveInstitutionName(a.plaidItemId, a.institutionName, institutionNameByItem)`. FAIL-OLD (`??` restored): **3 failed | 1 passed | 103 skipped**.

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r7`): cycle 1 PASS 0 P0 / 0 P1 / 3 P2.** Independently: tsc 0, eslint 0, 130/130, FAIL-OLD 3|1|103, kill-call stamp-only 4 failed. P2s in STATUS.

## #752 — O.20j residual (6): combine and /accounts use the Map.has institution join (2026-09-18)

**Context.** #750 critic P2-1: `buildCombineInputs` and `/accounts` `identityOf` still inlined `item?.institutionId ?? stamp`. A present-null live PlaidItem inherited the account stamp, so the identity ladder could prove SAME and offer a combine while the transfer writer fail-closed.

**Decision.** Both surfaces call `resolveLiveInstitutionId` (Map.has). Present null stays null; missing item still uses the stamp (disconnect). Live 0977 (`ins_56` over a null stamp) is unchanged. `isTransfer` add-only. H.7b not auto-run. No schema change. `institutionName` still uses `??` (critic P2-1 this cycle: names are ignored whenever either side has an id; both-null name match is the documented ladder fallback).

**Locked.** `tests/unit/combine-connections-server.test.ts`: present-null + stale stamp → `engineAccounts[0].institutionId` null; missing item → stamp; live `ins_56` over null stamp; `getAccountsView` present-null + matching stamps → no combine offer, `bank-id-missing`. `tests/unit/transfer-pair-identity.test.ts`: both files call `resolveLiveInstitutionId(a.plaidItemId, a.institutionId, institutionIdByItem)`. FAIL-OLD (`??` restored): **3 failed | 95 skipped**.

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r6`): cycle 1 PASS 0 P0 / 0 P1 / 4 P2.** Independently: tsc 0, eslint 0, 98/98, FAIL-OLD 3|95, kill-call stamp-only 5 failed. P2s in STATUS.

## #751 — Owner Yes on the ops walkthrough and the two live-data writes (2026-09-18)

**Context.** After #750 the owner asked what they still needed to do. Four optional
items were named. Owner, verbatim: **"3. Yes. 4. Yes."** — (3) a first-timer
walkthrough for Neon backups, cron fire, and Sentry; (4) undo the nine
`unsupported` Combined-accounts supersessions and seed demo holdings on
production.

**Decision.** Write the walkthrough from official / in-app labels
(`docs/OPS_WALKTHROUGH.md`). Do not invent a bulk-undo script — U.15 (b) already
has per-link **Undo** on `/accounts`, reversible via `undoneAt`. Do not run
`prisma db seed`. Seed holdings only via `npm run seed:demo-holdings` (additive,
demo `acct-brokerage`, INVESTMENT-gated). This VM has no `DATABASE_URL` and will
not decrypt Vercel env, so the two writes stay owner-executed. Do not flip
`DATA_PROVIDER=plaid`. Do not undo GENUINE / UNTESTABLE links. Sentry is DSN-only
(no `@sentry/wizard`); #203's "deferred paid tracking" still holds — Developer
plan + `SENTRY_DSN` is enough. Cron fire stays UNVERIFIED until the owner reads a
200 in Vercel **View Logs** after 11:00 UTC (Hobby ~1h log retention; a 24h
`requestPath` group on 2026-09-18 returned zero `/api/cron/*` lines).

**Locked.** Docs only. No money-math change. No schema change.

## #750 — O.20j residual (5): a present PlaidItem with null `ins_*` does not inherit the stamp (2026-09-18)

**Context.** #749 critic P2-1: `resolveLiveInstitutionId` used `Map.get` + `??`, so a *present* PlaidItem whose `institutionId` is `null` (pre-backfill) fell through to `Account.institutionId`. Two live copies with matching stale stamps then folded on last-4 — #748's fail-closed rule never ran. Map.has mutation on the #749 tree killed 0 tests.

**Decision.** `Map.has`: a present item (including null) is live and unproven; return `get(...) ?? null`. The stamp is last-known only after disconnect deletes the item (key absent). Live 0977 (`ins_56` over a null stamp) is unchanged. `isTransfer` add-only. H.7b not auto-run. No schema change. Mixed-type over-veto stays residual (1). combine-connections / `/accounts` keep their inline `??` (critic P2-1; not the transfer writer).

**Locked.** `tests/unit/transfer-pair-identity.test.ts`: helper golden (present-null + stale stamp → null); `test_regression__o20j_live_null_item_ignores_a_stale_matching_stamp` (joined ids stay null, no fold). `tests/unit/transfer-pair-filing.test.ts`: `test_regression__o20j_live_null_item_stale_stamp_still_overturns_a_purchase` (`{ overturned: 1 }`). FAIL-OLD (`??` restored): **3 failed | 84 passed**. Critic ignore-map: **7 failed | 80 passed**. Map.has always-true: **1 failed | 86 passed** (disconnect stamp fallback).

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r5`): cycle 1 PASS 0 P0 / 0 P1 / 6 P2.** Independently: tsc 0, 87/87, FAIL-OLD 3|84. P2s in STATUS.

## #749 — O.20j residual (4): the live 0977 fold reads PlaidItem `ins_*`, not the null stamp (2026-09-18)

**Context.** #748's critic P2-2: the filing 0977 lock stamped `Account.institutionId = ins_56` and never created a `PlaidItem` row. Live 0977 is the opposite (stamp NULL, item `ins_56`). A join regression to stamp-only would keep that fixture green and refuse the live fold, so a dining purchase vs a filed TRAVEL CREDIT would overturn again.

**Decision.** Extract `resolveLiveInstitutionId` (live item wins; stamp is last-known after disconnect deletes the item — same `??` join combine-connections already inlines). `loadTransferSweepRows` is the only transfer-identity caller; it must call the helper, not the stamp. The filing fixture is the measured shape: two `PlaidItem` rows with `ins_56`, both account stamps null, unique `${userId}-item-*` ids. `isTransfer` stays add-only. H.7b not auto-run. No schema change. Mixed-type over-veto stays residual (1); cycle-4 still refuses CREDIT≡CHECKING through a confirmed terminal.

**Locked.** `tests/unit/transfer-pair-identity.test.ts`: helper goldens (item over null stamp; stamp after missing item; item over stale stamp; missing both → null); live-shape fold through the helper; stamp-null without a map does not fold; `loadTransferSweepRows` source lock on `resolveLiveInstitutionId(a.plaidItemId, a.institutionId, institutionByItem)`. `tests/unit/transfer-pair-filing.test.ts`: live-shape Prisma fixture, `{ overturned: 0 }`. FAIL-OLD (stamp-only `a.institutionId ?? null` in transfer-refresh): **2 failed | 82 passed**. Ignore-map mutation (critic): **4 failed | 80 passed**.

**Critic (fresh context, isolated worktree `/tmp/_critic_o20j_r4`): cycle 1 PASS 0 P0 / 0 P1 / 4 P2.** Independently: tsc 0, 84/84, FAIL-OLD 2|82, ignore-map 4|80, Map.has (live-null no fallthrough) 0 died. P2s in STATUS.
