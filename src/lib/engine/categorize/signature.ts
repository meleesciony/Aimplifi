/**
 * Descriptor signature — the IDENTITY-preserving learning key for
 * categorize/learn.ts (DECISIONS #161).
 *
 * A signature is the raw descriptor with ONLY the parts that change between two
 * occurrences of the SAME recurring charge removed — dates and money amounts —
 * and everything that IDENTIFIES the counterparty KEPT, including account
 * numbers, phone numbers, check numbers and reference ids. Two occurrences of
 * the SAME payee therefore share one signature ("CREDIT CARD PAID 07/01" and
 * "…08/01" → "CREDIT CARD PAID"; "ZELLE PAYMENT TO LANDLORD" recurs verbatim),
 * while two DIFFERENT payees NEVER do (a phone/account number differs, so
 * "ZELLE PAYMENT TO 5551234567" and "…9998887777" stay distinct signatures).
 *
 * That last property is the load-bearing one. Cycle-1 and cycle-2 hostile review
 * both broke an earlier design that STRIPPED the numeric payee and then tried to
 * enumerate "channel words" (ZELLE, PAYMENT, SEND, MONEY, BANKING, PPD, …) to
 * detect a payee-less residue — an unwinnable whack-a-mole. Keeping the number
 * makes distinct payees structurally un-mergeable regardless of wording, so no
 * word list has to be complete for safety. hasDistinguishingToken below is now
 * only a SECONDARY guard, for a genuinely payee-less descriptor that recurs
 * verbatim ("CHECK PAID <date>").
 *
 * Erring toward UNDER-collapsing is the safe direction: a too-specific signature
 * merely fails to learn (row stays in review); a too-broad one mis-files money.
 *
 * No imports on purpose — consumed by both the pure pipeline (ruleMatches) and
 * learn.ts, so it must never create an import cycle.
 */

// Money amounts: 12.34 / 1,234.56 / $12.34 — a run of digits with exactly two
// decimal places. Stripped first so a "07.01"-style date can't be mistaken for
// one (dates have no cents; this only eats real amounts).
const AMOUNT_RE = /\$?\b\d[\d,]*\.\d{2}\b/g;
// ISO dates 2024-07-01, then slash/dash/dot dates 7/1, 07/01, 07-01-24, 07.01.2024.
// (Bare integers — check / account / phone numbers — are deliberately KEPT.)
const DATE_ISO_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
const DATE_SLASH_RE = /\b\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?\b/g;

/**
 * Payment-channel / aggregate ROOT words and pure connective GLUE. A signature
 * built ONLY from these carries no merchant/payee identity, so a learned rule on
 * it would file every unrelated payee. The check is STRUCTURAL, not an
 * enumeration of whole signatures: it survived hostile review that defeated an
 * earlier whole-string denylist by putting a phone number in the payee slot
 * ("ZELLE PAYMENT TO 5551234567" → stripped → "ZELLE PAYMENT TO", which a
 * denylist of "ZELLE PAYMENT" missed). Erring toward MORE noise words = refusing
 * more = the safe direction. Note the deliberate omissions: CREDIT, GIFT, and
 * brand words are NOT noise, so "CREDIT CARD PAID" (→ CREDIT survives) and
 * "ZELLE PAYMENT TO LANDLORD" (→ LANDLORD survives) still learn, while
 * "CHECK PAID", "CARD PAYMENT", "STORE CARD PURCHASE", "ZELLE PAYMENT TO <#>"
 * are refused.
 */
const NOISE_TOKENS: ReadonlySet<string> = new Set([
  // aggregate / payment-channel roots
  'ZELLE', 'VENMO', 'PAYPAL', 'CASHAPP', 'SQUARE', 'SQ',
  'CHECK', 'CHK', 'ECHECK', 'DRAFT',
  'ATM', 'WITHDRAWAL', 'WITHDRAW', 'DEPOSIT',
  'ACCOUNT', 'ACCT', 'TRANSFER', 'XFER', 'WIRE', 'ACH', 'EFT', 'PPD', 'CCD', 'IAT', 'TEL',
  'PAYMENT', 'PAYMT', 'PYMT', 'PMT', 'PMNT', 'PAY', 'AUTOPAY', 'BILLPAY', 'BILL', 'EPAY',
  'SEND', 'SENT', 'MONEY', 'FUNDS', 'BANKING', 'RECIPIENT', 'PAYEE', 'EXTERNAL', 'INTERNAL',
  // NB: CREDIT is deliberately NOT noise — it is the sole distinguishing token in
  // "CREDIT CARD PAID", the owner's headline case (a credit-card payment is a
  // transfer, so learning it is both wanted and correct).
  'CARD', 'PURCHASE', 'POS', 'STORE', 'DEBIT', 'ONLINE', 'MOBILE', 'WEB', 'RECURRING', 'PAID',
  'SAVINGS', 'CHECKING', 'SAV', 'DDA', 'ELECTRONIC',
  // generic transaction-TYPE / bank-MECHANISM labels many billers share (a real
  // merchant always carries a brand token BESIDES these, so only a payee-less
  // "DIRECT DEBIT" / "POINT OF SALE" / "SERVICE CHARGE" / "LOAN PAYMENT" residue
  // is refused; "SOFI LOAN PAYMENT" keeps SOFI, "GEORGIA POWER BILLPAY" keeps
  // GEORGIA POWER)
  'DIRECT', 'PREAUTHORIZED', 'PREAUTHORISED', 'PREAUTH', 'POINT', 'SALE',
  'SERVICE', 'CHARGE', 'CHARGES', 'FEE', 'FEES', 'MONTHLY', 'ANNUAL',
  'MAINTENANCE', 'OVERDRAFT', 'NSF', 'INTEREST', 'FINANCE', 'LOAN', 'PRINCIPAL',
  'PENDING', 'MISC', 'MEMO', 'ADJUSTMENT', 'PROCESSING', 'PROCESSED',
  // payment-FREQUENCY adjectives + card-ENTRY modes: the bare autopay/POS labels
  // US banks emit with no payee ("AUTOMATIC PAYMENT <date>", "SCHEDULED PAYMENT",
  // "PIN PURCHASE", "SIGNATURE DEBIT"). These have no account/phone number to keep
  // distinct billers apart, so a learned rule on the bare residue would transplant
  // one biller's category onto an unrelated one (hostile-critic cycle 4). A real
  // merchant always keeps a brand token BESIDES these — GENERAL MOTORS→MOTORS,
  // AUTOMATIC DATA PROCESSING→DATA, SIGNATURE PROPERTIES→PROPERTIES — so adding
  // them only refuses the genuinely payee-less residue (the safe direction).
  'AUTOMATIC', 'AUTOMATED', 'AUTO', 'SCHEDULED', 'REGULAR', 'PERIODIC',
  'PREARRANGED', 'GENERAL', 'STANDARD', 'PIN', 'SIGNATURE',
  // connective glue / reference labels
  'TO', 'FROM', 'FOR', 'THE', 'A', 'AN', 'OF', 'AND', 'ON', 'AT', 'VIA',
  'REF', 'ID', 'CONF', 'CONFIRMATION', 'NO', 'NUM', 'TRANS', 'TRANSACTION',
]);

/**
 * Does this signature retain at least one DISTINGUISHING token — a word (has a
 * letter) that is not a payment-channel root or glue? If not, learning on it is
 * refused. This is the single guard that stops one "Zelle → rent" (or any
 * payee-less aggregate) from filing every Zelle as rent.
 */
export function hasDistinguishingToken(signature: string): boolean {
  for (const tok of signature.split(' ')) {
    if (!tok) continue;
    if (NOISE_TOKENS.has(tok)) continue;
    if (!/[A-Z]/.test(tok)) continue; // pure number / symbol — an id, not a payee
    return true;
  }
  return false;
}

/**
 * Deterministic, pure. Returns '' for a descriptor that reduces to nothing
 * (all-noise) — the caller treats an empty signature as unkeyable.
 */
export function computeDescriptorSignature(rawDescriptor: string): string {
  let s = rawDescriptor.toUpperCase();
  s = s.replace(AMOUNT_RE, ' ');
  s = s.replace(DATE_ISO_RE, ' ');
  s = s.replace(DATE_SLASH_RE, ' ');
  // Everything that is not a letter/digit/ampersand becomes a space, then
  // collapse. Keeps payee words AND identity numbers (account/check/phone);
  // drops punctuation. Numbers are RETAINED on purpose — see the module header.
  s = s.replace(/[^A-Z0-9&]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}
