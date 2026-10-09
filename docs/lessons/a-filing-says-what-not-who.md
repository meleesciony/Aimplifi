# A filing says what a row is, not who charged it — and a denylist of payees is never finished

**One line.** When a surface's sentence names a NARROWER class than the category it reads ("bank and card fees"
⊂ Fees & Charges), gate on an ALLOWLIST of the narrower class's own words and LIST what fails — never a denylist of
what the rows aren't.

**What happened (#796, "Fees you paid", 2026-10-09).** The first draft counted every money-out row filed under Fees &
Charges / ATM Fee / Late Fee as a bank fee. Critic cycle 1 ran the real categorizer and found its generic rule files
"… MAINTENANCE FEE / LATE FEE / SERVICE CHARGE" there whoever charged it: HOA and timeshare maintenance, apartment late
fees, overdraft-protection TRANSFERS, a bounced deposit's principal — headlined "You paid $1,900.00 in bank fees". The
fix was a denylist of businesses (HOA, TIMESHARE, RESORT, APARTMENT, UTILITY …). Cycle 2 broke it in one probe run:
WESTGATE, BLUEGREEN, ASSOCIA maintenance fees; SOLID WASTE, ALARM MONITORING, PAYMENTUS service charges; RENTCAFE,
DIRECTV, CITY OF AUSTIN late fees; "NAVIENT PAYMENT INCL LATE FEE" (a loan payment). Every name the list missed was
counted. The same cycle found money in worded "INCOMING WIRE CREDIT … PROFESSIONAL FEES" counted as a fee coming back:
the give-back test was "a fee word + a refund word", and CREDIT is a refund word.

**The rule that held.** After the noise a bank adds is removed (digits, masks, dates, an overdraft notice's item tail),
EVERY word left must be a fee word, a connective, or one kind's own vocabulary with one of its anchors. One stranger
word — a business's name, a payment, a product, "CHARGE-BACK" — and the row is listed as "filed as fees, not counted",
with its amount, never charged. Errs low by construction, and the copy says "at least".

**Why it generalizes.**
- A category is a bucket the categorizer fills by keyword; its members share a WORD, not a payee. Any claim about the
  payee ("your bank charged you") is narrower than the bucket and needs its own evidence.
- A denylist is a claim that you have enumerated everything the class is NOT. An allowlist is a claim that you have
  enumerated what the class IS — finite, testable word by word, and when it is wrong it is wrong LOW.
- "Listed, not counted" keeps the evidence visible (a-vetos-blast-radius: too dangerous to gate on is not too
  dangerous to show) and makes the low direction auditable by the reader.
- A NET ("so they cost you $X") is a claim that every give-back was found; when the give-back test is conservative the
  net overstates. Print the two facts, never the difference.
- **Words cannot bound money; an amount can.** Cycle 3 found "INCOMING WIRE TRANSFER 2207 SERVICE FEES" (+$4,000.00) —
  every word a wire fee's word — counted as "$4,000.00 of fees came back". No vocabulary separates a $4,000 wire from a
  $15 wire-fee refund. What does: money back can never exceed what was charged of that kind on that account. Cap it
  (oldest first, to the cent) and the worst a mis-read credit can do is fee-sized.
- **Pin the lists exactly.** A test that loops over the allowlist proves each word works; it cannot notice a word ADDED
  — and an added word is the direction that overstates. `toEqual` the sorted lists.

**How to apply.** Before shipping a figure whose sentence names WHO (a bank, an employer, a landlord) over a category
that names WHAT: (1) run the real categorizer over realistic other-payee descriptors that share the category's
keywords; (2) if any lands in the figure, switch to an allowlist and list the remainder; (3) test every allowlist word
alone (a vocabulary word no test needs is a word nobody checked); (4) give the reader the amount you left out.

Related: [[a-typed-key-is-a-pattern-not-an-identity]], [[a-vetos-blast-radius-is-not-the-booleans-scope]],
[[money-taken-back-is-found-by-what-it-is-not-whose-name-it-carries]], [[a-narrowed-word-list-reopens-what-it-caught]].
