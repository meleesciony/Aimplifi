# A wrap rule that stops an overflow can split the content instead — and no text gate can see it

**One line:** `break-words` on a three-tile grid and `break-all` on an account name both keep content
on the screen at 380px, and both shipped a worse defect the overflow gate cannot detect: a balance
printed as "$12,495.0" / "0" and a card printed as "Sap" / "phire Card".

## What happened

M.3 (#265, `4ae5921c`, 2026-07-22) fixed money clipping in the `grid-cols-3` strips by letting the
figure wrap: /forecast's 30/60/90-day tiles got `break-words`. The register's account name had
carried `break-all` since the first inline-edit slice (`4fa488fe`, 2026-06-16). The overflow gate
(`document.scrollWidth <= clientWidth`) was green on both routes and stayed green.

The 2026-10-02 usability audit (TASKS U.1) found both by looking at screenshots. Three tiles at
380px leave about 86px for a figure that needs about 93, so the browser — told it may break
anywhere — broke the number. `break-all` breaks at ANY character to fill a line, so a two-word
name that would have wrapped cleanly at its space was cut in the middle of the first word.

Every existing check passed, and each for a sound reason:

- The overflow gate measures whether content leaves the screen. Broken content fits perfectly.
- `toHaveText` / `toContainText` read `textContent`. A figure on two lines has the same text.
- `toBeVisible` is true of both halves.
- axe has no rule for "this number is on two lines".

## The rules

1. **Wrapping is for prose. A figure, a date and a name are tokens.** A figure gets
   `whitespace-nowrap`; a name gets `overflow-wrap: anywhere` (wrap at spaces first, break inside
   a word only when that word alone cannot fit). `break-all` is for strings with no word
   boundaries at all — raw bank descriptors, ids — and nothing else.
2. **If a token does not fit, change the layout, not the token.** Three tiles became three rows
   on a phone. Shrinking the type fits today's amounts and breaks at the next digit.
3. **Lock it with geometry.** `Range.getClientRects().length` over the token's text is 1 when it
   sits on one line and 2 or more when it is split (`lineBoxesPerWord` in
   `tests/e2e/usability-pass.spec.ts`). That is the assertion a text gate cannot make.
4. **A green overflow gate after a wrap fix is half a verdict.** The fix moved the failure from
   the horizontal axis to the vertical one. Look at the screenshot before closing the row.

## The wider point

Eleven defects were found in that audit on pages that were passing every gate, and all eleven
were found the same way: by rendering each route at 380px and reading the picture. A gate
answers the question it was written for. "Does this look right to a person" was not anyone's
question until someone looked.
