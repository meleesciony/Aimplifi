# A sum remap is not a detection remap

**Summary:** remapping predecessor rows onto a live account id is correct for a total and wrong for anything that infers cadence from gaps. Concatenating two feeds' history of one merchant is how a regular series dies.

## How it bit (C.22)

The income fix re-keys a reconciled predecessor onto the payment account and then sums. The radar's committed-merchant set is `detectRecurring` over that same scope. The income-replay probe measured the reflex: 9 series on the live id, 4 after re-key. The task row prescribed merging descriptors before detection. That is the concatenate.

Monthly detection is median-only, so a single 0-day handover gap is not always enough to kill a series. Three amounts, or the old feed's irregular dates on the same canonical, are. The new feed's clean monthly Netflix disappears the moment the old feed's messy Netflix rows join the same group.

## The rule

A remap that is safe for a SUM is not safe for gap inference. Detect each source on its own, then union the verdicts. Remap (and collapse the released handover day) only for the total.
