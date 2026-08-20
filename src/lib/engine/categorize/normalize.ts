/**
 * Merchant normalization — the layer where Mint/Simplifi rules break.
 * rawDescriptor → canonical merchant (+ default category + confidence hint).
 *
 * Two stages:
 *  1. KNOWN_MERCHANTS: ordered pattern table → canonical merchant. This is the
 *     same data that seeds the Merchant/MerchantPattern tables.
 *  2. Generic cleanup fallback for unknown descriptors: strip processor
 *     prefixes ("SQ *", "TST*", "PAYPAL *"), store numbers, POS/terminal ids,
 *     phone numbers, city/state suffixes → title-cased candidate, low confidence.
 */

/**
 * THE transfer-descriptor pattern. Anchored/word-bounded on purpose: substring
 * matches silently erased real spending ("T-MOBILE PREPAY" ⊃ "EPAY",
 * "GIFT CARD PAYMENT" ⊃ "CARD PAYMENT") — Hostile Critic finding F4.
 * Transfer DETECTION consumes the normalizer's verdict, so the two modules
 * cannot disagree.
 */
export const TRANSFER_DESCRIPTOR =
  /\bEPAY(MENT)?\b|^PAYMENT THANK YOU\b|^ONLINE TRANSFER\b|^SYNCB STORE CARD PAYMENT\b|^AUTOPAY PAYMENT\b|^ACH WITHDRAWAL CARMAX/i;

export interface MerchantMatch {
  canonical: string;
  categoryId: string;
  /** 0–10000. Known merchants ≥ 9000; ambiguous kinds (Zelle, checks) lower. */
  confidenceBps: number;
  known: boolean;
  /**
   * An AGGREGATE pseudo-merchant (Zelle, checks, ATM): one canonical name
   * covers many unrelated payees, so durable merchant-wide rules must never
   * be offered for it — one "Always" would permanently mis-file everything.
   */
  aggregate: boolean;
}

/**
 * BANK-SIDE noise prefixes (categorization-quality pass, DECISIONS #163): many
 * banks prepend a fixed transaction-channel phrase to every card descriptor —
 * Wells Fargo's "PURCHASE AUTHORIZED ON 06/12", BofA's "CHECKCARD 0612",
 * "POS DEBIT - ", "DEBIT CARD PURCHASE - ", "RECURRING PAYMENT AUTHORIZED ON…".
 * The ^-anchored KNOWN_MERCHANTS table can't see a brand behind such a prefix,
 * so EVERY transaction from those banks previously fell to keyword/vocab tiers
 * or review. Stripping is deliberately conservative: each pattern is a full,
 * unambiguous channel phrase (never a lone word), anchored at the start, and
 * applied repeatedly so stacked prefixes ("PURCHASE AUTHORIZED ON 06/12 POS")
 * unwrap. Card masks (XXXX1234 / ****1234 / "CARD 1234 ENDING IN") are noise
 * anywhere in the string. Demo/seed descriptors carry none of these forms, so
 * their normalization is byte-identical.
 */
const BANK_PREFIX_PATTERNS: readonly RegExp[] = [
  /^(PURCHASE|RECURRING PAYMENT|RECURRING|PAYMENT)\s+AUTHORIZED\s+ON\s+\d{1,2}\/\d{1,2}(\/\d{2,4})?\s*/i,
  /^POS\s+(DEBIT|PURCHASE|PUR|W\/D)\s*[-–—]?\s*/i,
  /^DEBIT\s+CARD\s+(PURCHASE|PMT|PAYMENT)\s*[-–—]?\s*/i,
  /^(CHECK\s?CARD|CHKCARD|CHKCARDPOS)\s+(\d{2,4}\s+)?/i,
  /^(VISA|MASTERCARD|MC)\s+(DEBIT|PURCHASE|CHECK\s?CARD)\s*[-–—]?\s*/i,
  /^DBT\s+CRD\s+\d{4}\s*/i,
  /^CARD\s+PURCHASE\s*[-–—]?\s*(\d{2}\/\d{2}\s*)?/i,
  // Web-billpay + refund channel prefixes: the payee follows the prefix, and a
  // refund files back to the payee's own category (returns OFFSET the original
  // spend — the Mint/Simplifi convention, #163).
  /^WEB\s+PMT\s+/i,
  /^REFUND[:\s-]+/i,
];
/** Card masks + "CARD ENDING IN 1234" fragments — noise anywhere in the string. */
const CARD_MASK_RE = /\b(X{2,}\s?\d{2,4}|\*{2,}\d{2,4}|CARD\s+ENDING\s+IN\s+\d{4}|ENDING\s+IN\s+\d{4})\b/gi;

/** Strip bank-channel prefixes + card masks. Returns the input unchanged when none apply. */
export function stripBankNoise(raw: string): string {
  let s = raw.trim();
  for (let pass = 0; pass < 3; pass++) {
    const before = s;
    for (const p of BANK_PREFIX_PATTERNS) s = s.replace(p, '');
    if (s === before) break;
  }
  s = s.replace(CARD_MASK_RE, ' ').replace(/\s{2,}/g, ' ').trim();
  // Never strip the whole descriptor away — a bare "POS DEBIT" row must keep
  // its original text (it IS the payee-less descriptor, and review is correct).
  return s.length >= 3 ? s : raw.trim();
}

interface KnownMerchant {
  pattern: RegExp;
  canonical: string;
  categoryId: string;
  confidenceBps?: number; // default 9600
  aggregate?: boolean;
}

/** Ordered: first match wins. Specific before generic. */
export const KNOWN_MERCHANTS: KnownMerchant[] = [
  // Square / Toast / processor-prefixed locals
  // (Leaf-precision pass #163: defaults re-pointed from coarse parents to the
  //  specific leaves the taxonomy has offered since #63/#65 — Blue Bottle is a
  //  COFFEE shop, not generic dining; matching Mint/Simplifi leaf precision.)
  { pattern: /^SQ \*BLUE BOTTLE/i, canonical: 'Blue Bottle Coffee', categoryId: 'coffee' },
  { pattern: /^SQ \*PONCE CITY DONUTS/i, canonical: 'Ponce City Donuts', categoryId: 'dining' },
  { pattern: /^TST\*\s*HATTIE B/i, canonical: "Hattie B's", categoryId: 'dining' },
  { pattern: /^TST\*\s*FOX BROS/i, canonical: 'Fox Bros BBQ', categoryId: 'dining' },
  // Amazon family — AWS and Prime BEFORE the retail catch-alls (#163: AWS is
  // cloud software; Prime is a membership subscription, not a purchase), then
  // Mktp, retail, refunds, and the bare 'AMZN' truncation real feeds send
  // ('AMZN.COM/BILL WA', 'AMZN DIGITAL').
  { pattern: /^AMAZON WEB SERVICES|^AWS\.AMAZON|^AWS\b/i, canonical: 'Amazon Web Services', categoryId: 'software' },
  { pattern: /^AMAZON PRIME|^AMZN PRIME/i, canonical: 'Amazon Prime', categoryId: 'subscriptions' },
  { pattern: /^AMZN Mktp/i, canonical: 'Amazon', categoryId: 'shopping' },
  { pattern: /^AMAZON(\.COM)?/i, canonical: 'Amazon', categoryId: 'shopping' },
  { pattern: /^AMZN\b/i, canonical: 'Amazon', categoryId: 'shopping' },
  // PayPal pass-throughs
  { pattern: /^PAYPAL \*SPOTIFY/i, canonical: 'Spotify', categoryId: 'entertainment' },
  { pattern: /^PAYPAL \*ETSY/i, canonical: 'Etsy', categoryId: 'shopping' },
  // Airport POS
  { pattern: /^HMSHOST-/i, canonical: 'Airport Dining', categoryId: 'dining' },
  // Costco: gas vs warehouse are DIFFERENT merchants (and categories)
  { pattern: /^COSTCO GAS #/i, canonical: 'Costco Gas', categoryId: 'fuel' },
  { pattern: /^COSTCO WHSE #/i, canonical: 'Costco', categoryId: 'groceries' },
  // Rideshare / delivery. Uber Eats: 'food-delivery', matching the generic
  // keyword rule — the two tables previously disagreed (dining vs food-delivery)
  // for the same canonical depending on which variant string arrived (Phase 3a).
  { pattern: /^UBER\s+\*?\s*EATS/i, canonical: 'Uber Eats', categoryId: 'food-delivery' },
  { pattern: /^UBER\s+\*?\s*TRIP/i, canonical: 'Uber', categoryId: 'transport' },
  { pattern: /^LYFT \*/i, canonical: 'Lyft', categoryId: 'transport' },
  { pattern: /^(DD \*)?DOORDASH/i, canonical: 'DoorDash', categoryId: 'food-delivery' },
  { pattern: /^GRUBHUB\b/i, canonical: 'Grubhub', categoryId: 'food-delivery' },
  // Subscriptions
  { pattern: /^NETFLIX/i, canonical: 'Netflix', categoryId: 'entertainment' },
  { pattern: /^SPOTIFY/i, canonical: 'Spotify', categoryId: 'entertainment' },
  { pattern: /^APPLE\.COM\/BILL/i, canonical: 'Apple', categoryId: 'software' },
  { pattern: /^GOOGLE \*YOUTUBEPREMIUM/i, canonical: 'YouTube Premium', categoryId: 'entertainment' },
  { pattern: /^GOOGLE\s*\*?\s*ONE\b/i, canonical: 'Google One', categoryId: 'software' },
  // Round1 (arcade / bowling / entertainment venue): "ROUND1", "ROUND1 AM",
  // "round1am", "ROUND 1" — the trailing (?:\s?AM)? lets the smashed "ROUND1AM"
  // form match without a word boundary swallowing it. #161 owner-reported miss.
  { pattern: /^ROUND\s?1(?:\s?AM)?\b/i, canonical: 'Round1', categoryId: 'entertainment' },
  { pattern: /^LA FITNESS/i, canonical: 'LA Fitness', categoryId: 'fitness' },
  { pattern: /^(PF \*)?PLANET FIT/i, canonical: 'Planet Fitness', categoryId: 'fitness' },
  { pattern: /^HELLOFRESH/i, canonical: 'HelloFresh', categoryId: 'groceries' },
  // Geico: the *AUTO product line goes to the auto-insurance leaf (#163);
  // a bare GEICO (could be renters/umbrella) stays generic insurance.
  // (?!PAY) so 'GEICO AUTOPAY' — the payment CHANNEL, not the product line —
  // stays generic insurance; only the real *AUTO product token qualifies.
  { pattern: /^GEICO\s*\*?\s*AUTO(?!\s*PAY)/i, canonical: 'Geico', categoryId: 'auto-insurance' },
  { pattern: /^GEICO/i, canonical: 'Geico', categoryId: 'insurance' },
  // Comcast/Xfinity is cable internet — the internet leaf, not the
  // electric/water catch-all 'utilities' (#163).
  { pattern: /^COMCAST|XFINITY/i, canonical: 'Xfinity', categoryId: 'internet' },
  // Groceries / big box (patterns widened Phase 3a: real feeds vary the suffix —
  // 'KROGER QFC 5847', 'TARGET 00028031', 'TARGET.COM *', 'THE HOME DEPOT',
  // 'HOMEDEPOT.COM', 'SHELL SERVICE STATION' all previously missed their entry)
  { pattern: /^KROGER\b/i, canonical: 'Kroger', categoryId: 'groceries' },
  { pattern: /^PUBLIX/i, canonical: 'Publix', categoryId: 'groceries' },
  { pattern: /^SAFEWAY\b/i, canonical: 'Safeway', categoryId: 'groceries' },
  { pattern: /^TRADER JOE/i, canonical: "Trader Joe's", categoryId: 'groceries' },
  // 'WM SUPERC' (feed truncation of SUPERCENTER) must still match (#163)
  { pattern: /^WM SUPERC/i, canonical: 'Walmart', categoryId: 'shopping' },
  // Walmart also arrives as the bare brand ('WALMART', 'WAL-MART #1234',
  // 'WALMART.COM') — the #-suffixed WM SUPERCENTER form is only one of several
  // (real feeds vary): without this the biggest US retailer fell to unknown.
  { pattern: /^WAL[- ]?MART|^WALMART(\.COM)?\b/i, canonical: 'Walmart', categoryId: 'shopping' },
  { pattern: /^TARGET(\.COM)?\b/i, canonical: 'Target', categoryId: 'shopping' },
  // DEPARTMENT STORES + national retail the table was MISSING (O.13 owner report,
  // 2026-07-29: *"How is categorizer not identifying macys? A major big box
  // brand."*). The generic keyword tier below did list several of these brands —
  // as the STEMS `MACY`, `DILLARD`, `KOHL` — and `\bMACY\b` cannot match `MACYS`,
  // because the trailing S removes the word boundary the pattern needs. So the
  // apostrophe spelling worked (`MACY'S #123` → clothing) and the plural spelling
  // every bank actually sends did not (`MACYS LENOX SQUARE` → uncategorized).
  // Measured: 22 of 80 major-brand descriptors earned no category at all.
  //
  // They belong in this SPECIFIC tier rather than as a widened keyword stem, for
  // a reason worth stating: an entry here also fixes the NAME. The generic tier
  // only supplies a category, so the register kept printing 'Macys Lenox Square'
  // — the brand welded to the shopping mall it sits in. Anchored patterns are
  // prefix matches, so trailing location noise (a mall, a store number, a city)
  // never blocks the match and never reaches the canonical.
  { pattern: /^MACY'?S\b/i, canonical: "Macy's", categoryId: 'clothing' },
  { pattern: /^DILLARD'?S\b/i, canonical: "Dillard's", categoryId: 'clothing' },
  { pattern: /^BLOOMINGDALE'?S\b/i, canonical: "Bloomingdale's", categoryId: 'clothing' },
  { pattern: /^SAKS( ?FIFTH)?\b/i, canonical: 'Saks Fifth Avenue', categoryId: 'clothing' },
  { pattern: /^KOHL'?S\b/i, canonical: "Kohl's", categoryId: 'clothing' },
  { pattern: /^J\.? ?CREW\b/i, canonical: 'J.Crew', categoryId: 'clothing' },
  { pattern: /^VICTORIA'?S? ?SECRET\b/i, canonical: "Victoria's Secret", categoryId: 'clothing' },
  { pattern: /^BATH ?(&|AND) ?BODY ?WORKS\b/i, canonical: 'Bath & Body Works', categoryId: 'personal-care' },
  { pattern: /^PARTY CITY\b/i, canonical: 'Party City', categoryId: 'shopping' },
  { pattern: /^CABELA'?S\b/i, canonical: "Cabela's", categoryId: 'hobbies' },
  // Furnishings. 'JM*' is the processor prefix Joss & Main bills under, and the
  // digits that follow it are an order id that changes every purchase — exactly
  // the class O.13a's typed keywords exist for, so recognising the brand here
  // saves the reader from needing a rule at all.
  { pattern: /^JOSS ?(&|AND) ?MAIN\b|^JM\*\s?JOSS ?MAIN/i, canonical: 'Joss & Main', categoryId: 'furnishings' },
  { pattern: /^WILLIAMS[- ]?SONOMA\b/i, canonical: 'Williams Sonoma', categoryId: 'furnishings' },
  // Dining chains the table missed. 'DD/BR' is the Dunkin'/Baskin-Robbins combo
  // store code (the owner's own $10.70 row read 'Dd/br Q35'); Dunkin alone was
  // already recognised as coffee, so the combo follows it rather than inventing a
  // second answer for the same counter.
  { pattern: /^DD ?\/ ?BR\b/i, canonical: "Dunkin' / Baskin-Robbins", categoryId: 'coffee' },
  { pattern: /^BASKIN[- ]?ROBBINS\b/i, canonical: 'Baskin-Robbins', categoryId: 'fast-food' },
  { pattern: /^IN[- ]?N[- ]?OUT\b/i, canonical: 'In-N-Out Burger', categoryId: 'fast-food' },
  { pattern: /^FIREHOUSE SUBS\b/i, canonical: 'Firehouse Subs', categoryId: 'fast-food' },
  { pattern: /^BEN ?(&|AND) ?JERRY'?S\b/i, canonical: "Ben & Jerry's", categoryId: 'fast-food' },
  // In-park Walt Disney World vendors, which arrive as the park or resort code
  // plus whatever was sold ('WDW HYPERIONPOPCORN', 'EPCOT FACEPAINT' — both in the
  // owner's register). Deliberately NOT keyed on 'DISNEY': that word also carries
  // the streaming subscription, which is a different answer, and these two tokens
  // are unmistakable on their own.
  { pattern: /^WDW\b/i, canonical: 'Walt Disney World', categoryId: 'entertainment' },
  { pattern: /^EPCOT\b/i, canonical: 'Epcot', categoryId: 'entertainment' },
  // Dining chains (#163 leaf precision: counter-service chains are fast-food,
  // Starbucks is the canonical coffee-shop — the leaves Mint/Simplifi use)
  { pattern: /^CHICK-FIL-A/i, canonical: 'Chick-fil-A', categoryId: 'fast-food' },
  { pattern: /^MCDONALD'?S/i, canonical: "McDonald's", categoryId: 'fast-food' },
  { pattern: /^CHIPOTLE\b/i, canonical: 'Chipotle', categoryId: 'fast-food' },
  { pattern: /^STARBUCKS/i, canonical: 'Starbucks', categoryId: 'coffee' },
  { pattern: /^WAFFLE HOUSE/i, canonical: 'Waffle House', categoryId: 'dining' },
  // Fuel
  { pattern: /^SHELL (OIL|SERVICE)/i, canonical: 'Shell', categoryId: 'fuel' },
  { pattern: /^QT \d/i, canonical: 'QuikTrip', categoryId: 'fuel' },
  { pattern: /^CHEVRON/i, canonical: 'Chevron', categoryId: 'fuel' },
  // Travel (#163: an airline is the air-travel leaf, not the travel catch-all)
  { pattern: /^DELTA AIR/i, canonical: 'Delta Air Lines', categoryId: 'air-travel' },
  { pattern: /^MARRIOTT/i, canonical: 'Marriott', categoryId: 'travel' },
  { pattern: /^AIRBNB/i, canonical: 'Airbnb', categoryId: 'travel' },
  // Health (#163: CVS/Walgreens are drugstores — the pharmacy leaf, as
  // Mint/Simplifi file them; 'health' is for providers/clinics)
  { pattern: /^CVS\/PHARM/i, canonical: 'CVS Pharmacy', categoryId: 'pharmacy' },
  { pattern: /^WALGREENS/i, canonical: 'Walgreens', categoryId: 'pharmacy' },
  // Home improvement (#163: Home Depot/Lowe's are the home-improvement leaf;
  // 'household' is day-to-day household supplies)
  { pattern: /^(THE\s+)?HOME\s*DEPOT(\.COM)?\b/i, canonical: 'Home Depot', categoryId: 'home-improvement' },
  { pattern: /^LOWES/i, canonical: "Lowe's", categoryId: 'home-improvement' },
  // Phone / memberships (Phase 3a: top-tier national brands previously unmatched)
  { pattern: /^T-?MOBILE\b/i, canonical: 'T-Mobile', categoryId: 'phone' },
  { pattern: /^PATREON\b/i, canonical: 'Patreon', categoryId: 'entertainment' },
  { pattern: /^SPIRIT HALLOWEEN/i, canonical: 'Spirit Halloween', categoryId: 'shopping' },
  // Banking / income / obligations
  // Bound to the demo payees by NAME (checker: the old `.*RENT` / `.*PAYROLL`
  // substrings were convergence sinks on real feeds — 'ACH WITHDRAWAL … RENTERS
  // INS' would silently file as the demo's landlord at 9600). Real payroll/rent
  // still auto-file via the generic PAYROLL/DIRECT-DEP keyword rules.
  { pattern: /^ACH DEPOSIT ACME ANALYTICS/i, canonical: 'Acme Analytics (Payroll)', categoryId: 'income' },
  { pattern: /^ACH WITHDRAWAL PEACHTREE/i, canonical: 'Peachtree Properties (Rent)', categoryId: 'rent' },
  { pattern: /^ACH WITHDRAWAL CARMAX/i, canonical: 'CarMax Auto Finance', categoryId: 'auto-loan' },
  { pattern: /^STORE CARD PURCHASE/i, canonical: 'Store Card Purchase', categoryId: 'shopping', confidenceBps: 6000 },
  // ATM forms (#163): network/branded ATMs ('ALLPOINT ATM CASH WITHDRAWAL',
  // 'NON-BANK ATM WITHDRAWAL 000482 7-ELEVEN') are the same cash pocket.
  { pattern: /\b(NON-BANK )?ATM (CASH )?WITHDRAWAL\b/i, canonical: 'ATM Withdrawal', categoryId: 'cash' },
  // Utility e-payments (electric/gas/water billers pay via "EPAY"/"BILLMATRIX")
  // must be caught BEFORE the generic transfer pattern below, which would
  // otherwise mislabel a real utility bill as a transfer and silently drop it
  // from spend. Requires BOTH a utility token AND a biller-payment token, so card
  // payments ("CHASE EPAY", "AMEX EPAYMENT") are untouched. (Surfaced by the
  // adversarial categorization eval; resolves STATUS #11.)
  // 'LIGHT' added Phase 3a: 'CITY OF SEATTLE LIGHT EPAY' (a municipal electric
  // bill) matched the transfer pattern below and was silently erased from spend —
  // the same class as the DUKE ENERGY EPAY misfire (STATUS #11). Both tokens are
  // still required, so 'BUD LIGHT EPAY' remains contrived and card payments stay
  // untouched.
  // Split by service token (#154) so each bill files to its specific leaf; EVERY
  // branch still requires a biller-payment token, so the transfer-avoidance
  // guarantee is unchanged and 'CHASE EPAY'/'AMEX EPAYMENT' stay transfers.
  // Ordered trash → water → gas → electricity → generic: gas precedes electricity
  // so a gas biller that says "ENERGY"/"LIGHT" ('CENTERPOINT ENERGY EPAY',
  // 'ATLANTA GAS LIGHT EPAY') files as gas, not electricity. The trailing UTILIT(Y|IES)
  // branch is the catch-all for combined/unlabelled municipal bills. Every biller
  // token is either multi-word or a company name qualified with its service word
  // (CENTERPOINT ENERGY, SPIRE ENERGY/GAS) so a bare 'CENTERPOINT'/'SPIRE' in an
  // unrelated payee can't ride the EPAY token into a utility leaf (#154 critic).
  { pattern: /\b(WASTE|SANITATION|GARBAGE|TRASH|REFUSE|RECYCL|REPUBLIC SERVICES)\b.*\b(EPAY(MENT)?|BILLMATRIX|BILL ?PAY)\b/i, canonical: 'Trash Bill', categoryId: 'trash' },
  { pattern: /\b(WATER|SEWER|SEWAGE|AQUEDUCT)\b.*\b(EPAY(MENT)?|BILLMATRIX|BILL ?PAY)\b/i, canonical: 'Water Bill', categoryId: 'water' },
  { pattern: /\b(NATURAL GAS|GAS (CO|COMPANY|SVC|SERVICE|UTILITY)|NICOR|PIEDMONT (NATURAL )?GAS|CENTERPOINT ENERGY|SPIRE (ENERGY|GAS)|ATLANTA GAS|SOCAL ?GAS|WASHINGTON GAS|COLUMBIA GAS)\b.*\b(EPAY(MENT)?|BILLMATRIX|BILL ?PAY)\b/i, canonical: 'Gas Bill', categoryId: 'natural-gas' },
  { pattern: /\b(ENERGY|ELECTRIC|POWER|LIGHT)\b.*\b(EPAY(MENT)?|BILLMATRIX|BILL ?PAY)\b/i, canonical: 'Electric Bill', categoryId: 'electricity' },
  { pattern: /\bUTILIT(Y|IES)?\b.*\b(EPAY(MENT)?|BILLMATRIX|BILL ?PAY)\b/i, canonical: 'Utility Bill', categoryId: 'utilities' },
  // Transfers — the SAME anchored pattern transfer detection uses (one source
  // of truth; substring matching here once erased real spending — critic F4)
  { pattern: /^ONLINE TRANSFER/i, canonical: 'Account Transfer', categoryId: 'transfer' },
  // O.20j R6 / DECISIONS #486: brokerage overdraft *coverage* is a transfer,
  // not a bank fee. Must beat GENERIC `\bOVERDRAFT\b` → fees (OVERDRAFT FEE
  // still files as fees). Descriptor evidence alone flags unpaired legs — the
  // live $7,792.97 "Overdraft Transfer from Brokerage -7383" had no opposite
  // amount so pair detection never rescued it.
  { pattern: /\bOVERDRAFT\s+TRANSFER\b/i, canonical: 'Account Transfer', categoryId: 'transfer' },
  { pattern: TRANSFER_DESCRIPTOR, canonical: 'Card Payment', categoryId: 'transfer' },
  // Issuer card-payment ACH forms (#163): 'CHASE CREDIT CRD AUTOPAY PPD',
  // 'CAPITAL ONE CRCARDPMT', 'DISCOVER E-PAYMENT', 'BARCLAYCARD … CREDITCARD
  // PYMT' — each token is a full, issuer-specific payment phrase (never a lone
  // word), so real spending can't be swallowed (the F4 lesson). CARDMEMBER SERV
  // additionally requires a payment token (critic P3-8) so 'CARDMEMBER SERVICES
  // INTEREST CHARGE' — a real fee — is never erased as a transfer.
  { pattern: /\bCRCARDPMT\b|\bCREDIT CRD AUTOPAY\b|\bCREDITCARD PYMT\b|^DISCOVER\s+E-?PAYMENT|\bCARDMEMBER SERV\w*.*\b(PYMT|PAYMENT)\b/i, canonical: 'Card Payment', categoryId: 'transfer' },
  // ── Brand-coverage expansion (#163) — top-frequency US merchants real feeds
  // carry that the table previously missed entirely. Appended AFTER all original
  // entries (except the ambiguous block below) so no existing first-match
  // resolution changes; each is a specific, ^-anchored or tightly-worded brand.
  // Fast food / pizza chains whose descriptors carry no generic keyword:
  { pattern: /^SUBWAY\b/i, canonical: 'Subway', categoryId: 'fast-food' },
  { pattern: /^DOMINO'?S\b/i, canonical: "Domino's", categoryId: 'fast-food' },
  { pattern: /^PIZZA HUT/i, canonical: 'Pizza Hut', categoryId: 'fast-food' },
  { pattern: /^LITTLE CAESAR/i, canonical: 'Little Caesars', categoryId: 'fast-food' },
  { pattern: /^DAIRY QUEEN|^DQ (GRILL|#)/i, canonical: 'Dairy Queen', categoryId: 'fast-food' },
  { pattern: /^CULVER'?S/i, canonical: "Culver's", categoryId: 'fast-food' },
  { pattern: /^ZAXBY'?S/i, canonical: "Zaxby's", categoryId: 'fast-food' },
  { pattern: /^BOJANGLES/i, canonical: 'Bojangles', categoryId: 'fast-food' },
  { pattern: /^IN-?N-?OUT/i, canonical: 'In-N-Out', categoryId: 'fast-food' },
  { pattern: /^WINGSTOP/i, canonical: 'Wingstop', categoryId: 'fast-food' },
  { pattern: /^CHURCH'?S (TEXAS )?CHICKEN/i, canonical: "Church's Chicken", categoryId: 'fast-food' },
  // Groceries — regional banners + the WHOLEFDS truncation:
  { pattern: /^WHOLEFDS|^WHOLE FOODS/i, canonical: 'Whole Foods', categoryId: 'groceries' },
  { pattern: /^QFC\b/i, canonical: 'QFC', categoryId: 'groceries' },
  { pattern: /^FRED MEYER|^FRED-?MEY/i, canonical: 'Fred Meyer', categoryId: 'groceries' },
  { pattern: /^KING SOOPERS/i, canonical: 'King Soopers', categoryId: 'groceries' },
  { pattern: /^BJ'?S WHOLESALE|^BJS WHOLESALE/i, canonical: "BJ's Wholesale", categoryId: 'groceries' },
  // Fuel / convenience:
  { pattern: /^7-?ELEVEN/i, canonical: '7-Eleven', categoryId: 'fuel' },
  { pattern: /^BP[#\s]*\d/i, canonical: 'BP', categoryId: 'fuel' },
  { pattern: /^SHEETZ/i, canonical: 'Sheetz', categoryId: 'fuel' },
  { pattern: /^CASEY'?S/i, canonical: "Casey's", categoryId: 'fuel' },
  { pattern: /^PILOT (TRAVEL|#|\d)/i, canonical: 'Pilot', categoryId: 'fuel' },
  { pattern: /^LOVE'?S (TRAVEL|#|\d)/i, canonical: "Love's", categoryId: 'fuel' },
  { pattern: /^MURPHY (USA|EXPRESS)/i, canonical: 'Murphy USA', categoryId: 'fuel' },
  { pattern: /^BUC-?EE'?S/i, canonical: "Buc-ee's", categoryId: 'fuel' },
  // Airline ticket-number forms ('UNITED 0162341234567' — carrier + e-ticket):
  { pattern: /^(UNITED|AMERICAN|DELTA|ALASKA|SOUTHWEST|JETBLUE|SPIRIT|FRONTIER)\s+\d{7,}/i, canonical: 'Airline Ticket', categoryId: 'air-travel' },
  // Telecom:
  { pattern: /^AT&T\b|^ATT\s*\*|^ATT\b/i, canonical: 'AT&T', categoryId: 'phone' },
  { pattern: /^VZ ?WRLSS|^VERIZON WR?LS/i, canonical: 'Verizon Wireless', categoryId: 'phone' },
  { pattern: /^SPECTRUM MOBILE/i, canonical: 'Spectrum Mobile', categoryId: 'phone' },
  { pattern: /^GOOGLE\s*\*?\s*FI\b/i, canonical: 'Google Fi', categoryId: 'phone' },
  // Streaming / games / software one-offs:
  { pattern: /^GOOGLE \*YOUTUBE ?TV|^YOUTUBE ?TV\b/i, canonical: 'YouTube TV', categoryId: 'entertainment' },
  { pattern: /^STEAMGAMES|^STEAM PURCHASE/i, canonical: 'Steam', categoryId: 'games' },
  { pattern: /^MAX\.COM/i, canonical: 'Max', categoryId: 'entertainment' },
  { pattern: /^PARAMOUNT\s?(\+|PLUS)/i, canonical: 'Paramount+', categoryId: 'entertainment' },
  { pattern: /^KINDLE (UNLTD|UNLIMITED)/i, canonical: 'Kindle Unlimited', categoryId: 'books' },
  { pattern: /^ITUNES\.COM/i, canonical: 'Apple', categoryId: 'software' },
  { pattern: /^RING (YEARLY|MONTHLY|PROTECT|PLAN|BASIC)/i, canonical: 'Ring', categoryId: 'subscriptions' },
  // Retail / grocery / dining stragglers the benchmark surfaced (#163):
  { pattern: /^ETSY(\.COM)?\b/i, canonical: 'Etsy', categoryId: 'shopping' },
  { pattern: /^BESTBUY/i, canonical: 'Best Buy', categoryId: 'electronics' },
  { pattern: /^GIANT #/i, canonical: 'Giant Food', categoryId: 'groceries' },
  { pattern: /^MURPHY\d+AT/i, canonical: 'Murphy USA', categoryId: 'fuel' },
  { pattern: /^GREYSTAR\b/i, canonical: 'Greystar (Rent)', categoryId: 'rent' },
  { pattern: /^RENTPAYMENT\b/i, canonical: 'RentPayment', categoryId: 'rent' },
  // Airline + e-ticket smashed/truncated forms ('AMERICAN AIR0012345678901',
  // 'SOUTHWES 5262341234567', 'SPIRIT AIRL 4872341234567'):
  { pattern: /^(AMERICAN\s?AIR\w*|SOUTHWES\w*|SPIRIT(\s?AIRL\w*)?|UNITED|DELTA|ALASKA|JETBLUE|FRONTIER)\s*\d{7,}/i, canonical: 'Airline Ticket', categoryId: 'air-travel' },
  // Gig/platform payouts + expense reimbursements — Income-group leaves (#163):
  { pattern: /^STRIPE (TRANSFER|PAYOUT)/i, canonical: 'Stripe Payout', categoryId: 'side-income' },
  { pattern: /\b(UBER|LYFT) DRIVER\b|\bDASHER DIRECT\b/i, canonical: 'Gig Driving Payout', categoryId: 'side-income' },
  { pattern: /\bRENT PAYOUT\b|\bBUILDIUM\b/i, canonical: 'Rental Payout', categoryId: 'rental-income' },
  { pattern: /\bEXPENSE REIMB\w*\b|\bCONCUR\b|\bEXPENSIFY\b/i, canonical: 'Expense Reimbursement', categoryId: 'reimbursement' },
  // '<biller-noise> … WATER …' municipal water via web billpay (raw is matched
  // before the WEB PMT prefix is stripped, so this still sees the token):
  { pattern: /\bWEB PMT\b.*\bWATER\b/i, canonical: 'Water Bill', categoryId: 'water' },
  // Genuinely ambiguous — must go to review; aggregate ⇒ never offer rules
  { pattern: /^ZELLE PAYMENT/i, canonical: 'Zelle Payment', categoryId: 'uncategorized', confidenceBps: 4000, aggregate: true },
  { pattern: /^VENMO\b/i, canonical: 'Venmo', categoryId: 'uncategorized', confidenceBps: 4000, aggregate: true },
  // 'CHECK #2041', 'CHECK 2210', 'CHECK PAID #883' — one aggregate identity (#163).
  { pattern: /^CHECK( PAID)?\s*#?\s*\d/i, canonical: 'Check', categoryId: 'uncategorized', confidenceBps: 4000, aggregate: true },
  // Cash App / Apple Cash / bare PayPal transfers are the same class as
  // Zelle/Venmo (#163): one canonical hides many unrelated payees → review,
  // and durable merchant-wide rules must never be offered.
  { pattern: /^CASH ?APP\*?|^SQC\*CASH APP/i, canonical: 'Cash App', categoryId: 'uncategorized', confidenceBps: 4000, aggregate: true },
  { pattern: /^APPLE CASH/i, canonical: 'Apple Cash', categoryId: 'uncategorized', confidenceBps: 4000, aggregate: true },
  { pattern: /^PAYPAL (INST XFER|TRANSFER)/i, canonical: 'PayPal Transfer', categoryId: 'uncategorized', confidenceBps: 4000, aggregate: true },
];

/**
 * GENERIC keyword rules (DECISIONS #63) — applied ONLY after the specific
 * KNOWN_MERCHANTS table misses, so the demo (whose descriptors all match the
 * specific table) is untouched and every golden value holds. These broaden
 * auto-categorization to real-world merchant names a no-Plaid/SimpleFIN user
 * actually sees, mapping into the expanded taxonomy. Ordered: a more specific
 * category beats a broader one (fast-food/coffee before dining; pharmacy before
 * health; air-travel/hotel before travel). First match wins; confidence is high
 * enough to auto-file with a subtle "AI" badge, never silently.
 */
interface GenericRule {
  pattern: RegExp;
  categoryId: string;
}
const GENERIC_CONFIDENCE_BPS = 8500;
export const GENERIC_CATEGORY_RULES: GenericRule[] = [
  // Food & dining (specific → broad)
  { pattern: /\b(DOORDASH|GRUBHUB|UBER ?EATS|POSTMATES|SEAMLESS|INSTACART|GOPUFF|CAVIAR)\b/i, categoryId: 'food-delivery' },
  { pattern: /\b(DUNKIN|PEET'?S|DUTCH BROS|CARIBOU COFFEE|TIM HORTONS|SCOOTER'?S|PHILZ|LA COLOMBE|COFFEE|COFFE|CAFE|CAFÉ|ESPRESSO|ROASTER)\b/i, categoryId: 'coffee' },
  // (#163: plural/possessive-tolerant tokens — feeds send 'WENDYS' without the
  // apostrophe, which a bare \bWENDY\b can never match.)
  { pattern: /\b(BURGER KING|WENDY'?S?|TACO BELL|CHIPOTLE|POPEYE'?S?|ARBY'?S?|SONIC DRIVE|FIVE GUYS|SHAKE SHACK|RAISING CANE'?S?|WHATABURGER|JACK IN THE BOX|DEL TACO|HARDEE'?S?|JIMMY JOHN'?S?|PANERA|JERSEY MIKE'?S?|FIREHOUSE SUB|KFC|PAPA JOHN'?S?)\b/i, categoryId: 'fast-food' },
  { pattern: /\b(LIQUOR|WINE|SPIRITS|BREWING|BREWERY|TAPROOM|PUB|TAVERN|TOTAL WINE|ABC STORE|DISTILLER|BEVMO|SPEC'?S WINE|BINNY'?S)\b/i, categoryId: 'alcohol' },
  // Casual-dining chains whose names carry no generic food token (#163):
  { pattern: /\b(OLIVE GARDEN|TEXAS ROADHOUSE|APPLEBEE'?S?|OUTBACK|RED LOBSTER|CRACKER BARREL|CHILI'?S|BUFFALO WILD WINGS|IHOP|DENNY'?S|LONGHORN|RED ROBIN|CHEESECAKE FACTORY|P\.?F\.? CHANG)\b/i, categoryId: 'dining' },
  { pattern: /\b(GROCER|GROCERY|SUPERMARKET|WHOLE FOODS|SAFEWAY|ALDI|WEGMANS?|SPROUTS|H-?E-?B|FOOD LION|GIANT FOOD|STOP & SHOP|HARRIS TEETER|WINCO|FRESH MARKET|MEIJER|VONS|RALPHS|ALBERTSON'?S?|FOOD 4 LESS|WINN[- ]?DIXIE|PIGGLY WIGGLY|HY-?VEE|RALEY'?S?|SHOPRITE|PRICE CHOPPER|STATER BROS|SAVE MART|BI-?LO|GIANT EAGLE|MARKET BASKET|HANNAFORD|INGLES MARKET'?S?|LIDL|FARMERS'? (MARKET|MKT))\b/i, categoryId: 'groceries' },
  { pattern: /\b(RESTAURANT|GRILL|KITCHEN|BISTRO|DINER|EATERY|TAQUERIA|PIZZA|PIZZERIA|SUSHI|RAMEN|STEAKHOUSE|CANTINA|TRATTORIA|OYSTER|SEAFOOD|NOODLE|BAKERY|BAKESHOP|BAKERS|DELI|CATERING|CREAMERY|ICE CREAM|JUICE|SMOOTHIE|BAR ?& ?GRILL|BBQ)\b/i, categoryId: 'dining' },
  // Auto & transport
  { pattern: /\b(EXXON(MOBIL)?|MOBIL|TEXACO|MARATHON|SUNOCO|CITGO|VALERO|CONOCO|PHILLIPS 66|ARCO|SPEEDWAY|WAWA|RACETRAC|CIRCLE K|FUEL|PETRO|GASOLINE)\b/i, categoryId: 'fuel' },
  { pattern: /\b(TAXI|YELLOW CAB)\b/i, categoryId: 'transport' },
  { pattern: /\b(METRO TRANSIT|TRANSIT|MTA|BART|MARTA|SEPTA|AMTRAK|GREYHOUND|MEGABUS|FERRY|LIGHT RAIL|WSDOT|WMATA|NJT RAIL)\b/i, categoryId: 'public-transit' },
  { pattern: /\b(PARKING|PARKMOBILE|PAYBYPHONE|SPOTHERO|TOLL|EZ ?PASS|E-?ZPASS|SUNPASS|FASTRAK)\b/i, categoryId: 'parking' },
  { pattern: /\b(AUTOZONE|O'?REILLY|PEP BOYS|ADVANCE AUTO|NAPA|JIFFY LUBE|VALVOLINE|FIRESTONE|MIDAS|MEINEKE|DISCOUNT TIRE|CAR WASH|AUTO REPAIR|COLLISION|BODY SHOP|TAKE 5 OIL|OIL CHANGE)\b/i, categoryId: 'auto-maintenance' },
  // DMV / registration (#163) — its own leaf, before the fees/taxes tiers.
  { pattern: /\b(DMV\b|LICENSE PLATE|VEHICLE REG\w*|REGISTRATION FEE|TAG RENEWAL)\b/i, categoryId: 'auto-registration' },
  // Captive auto lenders (#163) — the recurring car-payment ACH everyone has.
  { pattern: /\b(TOYOTA FINANCIAL|GM FINANCIAL|HONDA FIN\w*|FORD (MOTOR )?CREDIT|NISSAN MOTOR AC\w*|HYUNDAI (MOTOR )?FIN\w*|ALLY (AUTO|FINANCIAL)|CHRYSLER CAPITAL|VW CREDIT)\b/i, categoryId: 'auto-loan' },
  // Travel
  { pattern: /\b(UNITED AIR|AMERICAN AIR\w*|SOUTHWEST AIR|JETBLUE|ALASKA AIR|SPIRIT AIR\w*|FRONTIER AIR|AIRLINE|AIR ?LINES?|ALLEGIANT|HAWAIIAN AIR)\b/i, categoryId: 'air-travel' },
  { pattern: /\b(HILTON|HYATT|HOLIDAY INN|HAMPTON INN|SHERATON|WESTIN|RITZ|COURTYARD|RESIDENCE INN|MOTEL|HOTEL|RAMADA|BEST WESTERN|LA QUINTA|DOUBLETREE|EMBASSY SUITES|FAIRFIELD INN|RESORT|WYNDHAM|SUPER 8|CHOICE HOTELS|COMFORT INN|QUALITY INN|DAYS INN|EXTENDED STAY|IHG\b)\b/i, categoryId: 'hotel' },
  { pattern: /\b(HERTZ|ENTERPRISE RENT|AVIS|BUDGET RENT|NATIONAL CAR|ALAMO|THRIFTY|DOLLAR RENT|SIXT|TURO|RENTAL CAR)\b/i, categoryId: 'rental-car' },
  { pattern: /\b(EXPEDIA|BOOKING\.COM|PRICELINE|TRAVELOCITY|KAYAK|ORBITZ|HOTWIRE|TRIPADVISOR|VACATION|CRUISE|VRBO|HOMEAWAY)\b/i, categoryId: 'travel' },
  // Health
  { pattern: /\b(RITE[- ]?AID|DUANE READE|PHARMACY|DRUG ?STORE)\b/i, categoryId: 'pharmacy' },
  // Insurance CARRIERS (premiums) — the payer, not the medical service. A Delta
  // Dental premium is dental INSURANCE, not a dentist visit (owner decision,
  // DECISIONS #115). These precede the dental/vision/health SERVICE rules below so
  // a carrier name wins; and the dental/vision carrier rules precede the broad
  // medical-carrier rule so "AETNA DENTAL" files as dental-insurance (the medical
  // rule's bare AETNA never reaches it). Insurance-family leaves sit in the
  // Bills & Utilities group, beside the existing auto-/health-/life-insurance.
  { pattern: /\b(DELTA DENTAL|CIGNA DENTAL|GUARDIAN DENTAL|METLIFE DENTAL|AETNA DENTAL|HUMANA DENTAL|UNITED ?HEALTHCARE DENTAL|AMERITAS|DENTAL (INS|INSURANCE|PREMIUM|PPO|HMO))\b/i, categoryId: 'dental-insurance' },
  { pattern: /\b(VSP|VISION SERVICE PLAN|EYEMED|DAVIS VISION|SUPERIOR VISION|VISION (INS|INSURANCE|PREMIUM|PPO))\b/i, categoryId: 'vision-insurance' },
  { pattern: /\b(BLUE ?CROSS|BLUE ?SHIELD|BCBS|ANTHEM|AETNA|CIGNA|HUMANA|KAISER PERMANENTE|UNITED ?HEALTHCARE|UHC|OSCAR HEALTH|MOLINA HEALTHCARE|WELLCARE|AMERIGROUP|HEALTH ?INSURANCE|MEDICAL ?INSURANCE)\b/i, categoryId: 'health-insurance' },
  { pattern: /\b(DENTAL|DENTIST|ORTHODONT|ENDODONT|PERIODONT)\b/i, categoryId: 'dental' },
  { pattern: /\b(VISION|OPTICAL|OPTOMETR\w*|EYE CARE|LENSCRAFTER|WARBY PARKER|EYEGLASS|PEARLE|MYEYEDR|VISIONWORKS|AMERICA'?S BEST CONT\w*)\b/i, categoryId: 'vision' },
  { pattern: /\b(GYM|FITNESS|YOGA|PILATES|CROSSFIT|PELOTON|EQUINOX|PLANET FIT|LIFE ?TIME|ORANGETHEORY|ANYTIME FITNESS|CYCLEBAR|SOULCYCLE|CLASSPASS|YMCA|F45)\b/i, categoryId: 'fitness' },
  // Mental-health platforms/providers before the broad health rule (#163) so
  // BETTERHELP files to its own leaf, not generic health.
  { pattern: /\b(BETTERHELP|TALKSPACE|CEREBRAL|PSYCHIATR|PSYCHOLOG|COUNSELING)\b/i, categoryId: 'mental-health' },
  // Veterinary BEFORE the broad health rule (#163): 'LAKESIDE VETERINARY
  // CLINIC' is a vet — the CLINIC token must not steal it into human health.
  // VETERINAR\w*: the bare stem never matched — \b after 'VETERINAR' fails
  // inside 'VETERINARY'/'VETERINARIAN' (latent in the original pets rule too).
  { pattern: /\b(VETERINAR\w*|ANIMAL (HOSPITAL|CLINIC))\b/i, categoryId: 'pets' },
  { pattern: /\b(HOSPITAL|CLINIC|MEDICAL|PHYSICIAN|HEALTHCARE|URGENT CARE|LABCORP|QUEST DIAGNOST\w*|RADIOLOGY|DERMATOLOG\w*|PEDIATRIC|WELLNESS|CHIROPRACT\w*|THERAPY|ONE MEDICAL)\b/i, categoryId: 'health' },
  // Personal & family
  { pattern: /\b(SALON|SPA|BARBER\w*|HAIRCUT|NAIL|MASSAGE|SEPHORA|ULTA|GREAT CLIPS|SUPERCUTS|WAXING|DRY CLEAN(ER|ING)?S?|CLEANERS|LAUNDROMAT|LAUNDRY|SALLY BEAUTY|FADES? BY)\b/i, categoryId: 'personal-care' },
  // Kids' clothing/gear chains → the kids leaf (#163), before generic clothing.
  // CARTER requires the apostrophe form or a store number (critic P1-3: bare
  // CARTER is a name/location word — 'JIMMY CARTER BLVD', 'CARTER BANK',
  // 'CARTERS LAKE MARINA' must never file as kids).
  { pattern: /\b(CARTER'S|CARTERS #\d|CHILDREN'?S PLACE|OSHKOSH|GYMBOREE|BUYBUY ?BABY)\b/i, categoryId: 'kids' },
  { pattern: /\b(PETCO|PETSMART|CHEWY|VETERINAR|ANIMAL HOSPITAL|PET ?SUPPL|PET ?FOOD|BARKBOX|BANFIELD|VCA ANIMAL|PETSUITES)\b/i, categoryId: 'pets' },
  { pattern: /\b(DAYCARE|CHILD ?CARE|PRESCHOOL|KINDERCARE|BRIGHT HORIZONS|BABYSIT|LEARNING CENTER)\b/i, categoryId: 'childcare' },
  // Education (#163): bare UNIVERSITY/COLLEGE removed — they are location/name
  // words in food & retail descriptors ('TST* THAI TOM UNIVERSITY' is a
  // restaurant near a campus, not tuition — a real misfile on the messy
  // corpus). Kept: unambiguous education-payment tokens.
  { pattern: /\b(TUITION|BURSAR|COMMUNITY COLLEGE|COURSERA|UDEMY|CHEGG|SCHOLAST|SKILLSHARE|MASTERCLASS|KHAN ACADEMY|DUOLINGO)\b/i, categoryId: 'education' },
  // Shopping
  // (GameStop moved to the games leaf, #163.)
  { pattern: /\b(BEST ?BUY|APPLE STORE|MICRO ?CENTER|NEWEGG|B&H PHOTO)\b/i, categoryId: 'electronics' },
  { pattern: /\b(NIKE|ADIDAS|LULULEMON|OLD NAVY|H&M|ZARA|UNIQLO|FOREVER 21|BANANA REPUBLIC|J\.?CREW|MADEWELL|NORDSTROM|MACY'?S?|DILLARD'?S?|TJ ?MAXX|MARSHALL|BURLINGTON|UNDER ARMOUR|FOOT LOCKER|KOHL'?S?|JCPENNEY|SHEIN|ROSS (DRESS|STORES)|AMERICAN EAGLE|ANTHROPOLOGIE|URBAN OUTFITTERS|STOCKX|POSHMARK|MERCARI|DEPOP|MARSHALLS?|CLOTHING|APPAREL)\b/i, categoryId: 'clothing' },
  { pattern: /\b(IKEA|WAYFAIR|ASHLEY FURN|POTTERY BARN|CRATE ?& ?BARREL|WEST ELM|HOME ?GOODS|FURNITURE|MATTRESS|BED BATH|CB2|ROOMS TO GO|AT HOME STORE)\b/i, categoryId: 'furnishings' },
  // Organization/storage retail → household (#163).
  { pattern: /\b(CONTAINER STORE)\b/i, categoryId: 'household' },
  { pattern: /\b(DICK'?S SPORTING|REI|ACADEMY SPORTS|BASS PRO|CABELA|HOBBY LOBBY|MICHAELS|JOANN|GUITAR CENTER|GOLF GALAXY|PGA (TOUR )?SUPERSTORE|SPORTING GOODS)\b/i, categoryId: 'hobbies' },
  { pattern: /\b(BARNES ?& ?NOBLE|BOOKSTORE|BOOKSHOP|BOOK NOOK|BOOKSELLER|BOOKS-?A-?MILLION|AUDIBLE)\b/i, categoryId: 'books' },
  // Warehouse clubs follow the Costco precedent → groceries (#163); dollar
  // stores are the general-merchandise leaf; Kohl's/JCPenney/SHEIN moved to
  // clothing above.
  { pattern: /\b(SAM'?S CLUB)\b/i, categoryId: 'groceries' },
  { pattern: /\b(DOLLAR TREE|DOLLAR GENERAL|FAMILY DOLLAR|BIG LOTS|FIVE BELOW)\b/i, categoryId: 'general-merchandise' },
  { pattern: /\b(EBAY|ALIEXPRESS|TEMU)\b/i, categoryId: 'shopping' },
  // Home
  { pattern: /\b(ACE (HARDWARE|HDWE)|MENARDS|HARBOR FREIGHT|HARDWARE|TRUE VALUE|SHERWIN[- ]?WILLIAMS)\b/i, categoryId: 'home-improvement' },
  // PLUMB\w*/LANDSCAP\w*: the bare stems never matched inside 'PLUMBING'/
  // 'LANDSCAPING' — \b after the stem fails mid-word (#163, same class as the
  // VETERINARY bug).
  { pattern: /\b(PLUMB\w*|HVAC|ELECTRICIAN|PEST CONTROL|TERMINIX|ORKIN|CLEANING SERVICE|LANDSCAP\w*|HANDYMAN|ROOFING|TRUGREEN|MERRY MAIDS|MOLLY MAID|STANLEY STEEMER)\b/i, categoryId: 'home-services' },
  { pattern: /\b(NURSERY|GARDEN CENTER|TRACTOR SUPPLY|LAWN (CARE|SERVICE|MAINT\w*)|MOWING)\b/i, categoryId: 'lawn-garden' },
  // Bills & utilities
  { pattern: /\b(VERIZON|SPRINT|CRICKET WIRELESS|MINT MOBILE|BOOST MOBILE|US CELLULAR|STRAIGHT TALK|METRO ?PCS|VISIBLE WIRELESS)\b/i, categoryId: 'phone' },
  { pattern: /\b(SPECTRUM|COX COMM|CENTURYLINK|FRONTIER COMM|OPTIMUM|WINDSTREAM|FIOS|GOOGLE FIBER|HUGHESNET|STARLINK)\b/i, categoryId: 'internet' },
  // Utilities split by service (#154), specific → generic. trash/water/gas run
  // before electricity so a gas biller that says "ENERGY" ('CENTERPOINT ENERGY')
  // isn't swallowed by electricity's bare POWER/ELECTRIC/ENERGY tokens. Bare
  // LIGHT is deliberately NOT an electricity token here (would catch 'BUD LIGHT');
  // 'CITY LIGHT' is. Company names are qualified with their service word
  // (CASELLA WASTE, CENTERPOINT ENERGY, SPIRE ENERGY/GAS) and 'REFUSE'/'WATER' are
  // required to appear as an actual utility phrase, so unrelated payees ('CASELLA
  // WINES', 'CITY WATER PARK', 'REFUSE TO LOSE LLC') no longer misfile (#154 critic).
  // The trailing UTILITY/MUNICIPAL branch keeps the old catch-all coverage; note a
  // combined utility spelled '<NAME> ENERGY' (DOMINION ENERGY) matches electricity
  // FIRST — only a bare 'DOMINION' / 'NATIONAL GRID' reaches this branch.
  { pattern: /\b(WASTE MANAGEMENT|WASTE MGMT|REPUBLIC SERVICES|SANITATION|GARBAGE|TRASH|REFUSE (COLLECTION|SERVICE|DISPOSAL)|RECYCLING|ADVANCED DISPOSAL|CASELLA WASTE|GFL ENVIRONMENTAL)\b/i, categoryId: 'trash' },
  { pattern: /\b(WATER (DEPT|UTILIT|BILL|SERVICE|WORKS|AUTHORITY|CO|COMPANY|DISTRICT)|MUNICIPAL WATER|SEWER|SEWAGE|AMERICAN WATER|AQUA (AMERICA|UTILIT))\b/i, categoryId: 'water' },
  { pattern: /\b(NATURAL GAS|GAS (CO|COMPANY|SVC|SERVICE|UTILITY)|NICOR|PIEDMONT (NATURAL )?GAS|ATLANTA GAS|SOCAL ?GAS|WASHINGTON GAS|COLUMBIA GAS|CENTERPOINT ENERGY|SPIRE (ENERGY|GAS)|NW NATURAL)\b/i, categoryId: 'natural-gas' },
  // Major US electric (and combined gas+electric) utility companies by brand name
  // or common acronym — these carry NO ELECTRIC/POWER/ENERGY word, so the token
  // rule below can't reach them, yet an electric bill is a high-value recurring row
  // everyone has. Acronyms are \b-bounded (outer \b(...)\b): 'SCE' matches alone but
  // not inside 'SCENE'. Combined gas+electric utilities (PG&E) file as electricity —
  // the primary "the power company" bucket; a bare gas biller already matched above.
  { pattern: /\b(PG&E|PGANDE|PACIFIC GAS (AND|&) ELECTRIC|SOUTHERN CALIFORNIA EDISON|SCE|CON ?EDISON|CONED|CONSOLIDATED EDISON|PSE&G|PSEG|PUBLIC SERVICE ELECTRIC|COMED|COMMONWEALTH EDISON|AMEREN|LADWP|DWP|SALT RIVER PROJECT|SRP|ENTERGY|FLORIDA POWER|FPL|PECO|BALTIMORE GAS|BGE|PEPCO|EVERSOURCE|WE ENERGIES|ARIZONA PUBLIC SERVICE|DTE)\b/i, categoryId: 'electricity' },
  { pattern: /\b(ELECTRIC(ITY)?|POWER|ENERGY|CITY LIGHT|DUKE ENERGY|GEORGIA POWER)\b/i, categoryId: 'electricity' },
  { pattern: /\b(UTILITY|UTILITIES|MUNICIPAL|DOMINION|NATIONAL GRID)\b/i, categoryId: 'utilities' },
  // Life-insurance carriers by brand + the explicit "life insurance" phrase
  // (incl. the space-stripped 'LIFEINSURANCE' feeds send). Placed BEFORE the generic
  // insurance rule so a life carrier files to the life leaf, not generic insurance.
  { pattern: /\b(NORTHWESTERN MUTUAL|NEW YORK LIFE|NY LIFE|PRIMERICA|MASS ?MUTUAL|LINCOLN FINANCIAL|TRANSAMERICA|JOHN HANCOCK|GUARDIAN LIFE|MUTUAL OF OMAHA|GERBER LIFE|COLONIAL PENN|GLOBE LIFE|BANNER LIFE|HAVEN LIFE|LADDER LIFE|TERM LIFE|WHOLE LIFE|LIFE ?INSURANCE)\b/i, categoryId: 'life-insurance' },
  // "AUTO/CAR INSURANCE" (spaced or space-stripped) → the auto-insurance leaf, not
  // generic insurance — closes the DECISIONS #115 open item. Before the generic rule.
  // Auto-dominant carriers (#163): Progressive, Root, and The General write
  // essentially only auto policies — Mint files them as Auto Insurance too.
  // Multi-line carriers (State Farm, Allstate, USAA…) stay generic insurance.
  // PROGRESSIVE requires an insurance token (critic P2-4): 'PROGRESSIVE
  // LEASING' is a rent-to-own fintech with weekly recurring debits.
  { pattern: /\b((AUTO|CAR|VEHICLE) ?INSURANCE|PROGRESSIVE ?\*? ?(INS\w*|INSURANCE|CASUALTY|AUTO)|ROOT INSURANCE|THE GENERAL INS)\b/i, categoryId: 'auto-insurance' },
  { pattern: /\b(STATE FARM|ALLSTATE|LIBERTY MUTUAL|NATIONWIDE|USAA|FARMERS INS|TRAVELERS INS|METLIFE|PRUDENTIAL|AFLAC|LEMONADE INS|AMICA|SAFECO|ERIE INSURANCE|INSURANCE)\b/i, categoryId: 'insurance' },
  // Entertainment & software
  // Games split to their own leaf (#163): consoles/launchers/publishers are
  // the 'games' subcategory, not generic entertainment. Runs BEFORE the broad
  // entertainment rule so XBOX/PLAYSTATION never reach it.
  { pattern: /\b(XBOX|PLAYSTATION|NINTENDO|EPIC GAMES|RIOT GAMES|BLIZZARD|ROBLOX|GAME PASS|GAMESTOP)\b/i, categoryId: 'games' },
  // Live-event ticketing → the events leaf (#163), before broad entertainment.
  { pattern: /\b(TICKETMASTER|STUBHUB|LIVE NATION|AXS\.COM|SEATGEEK)\b/i, categoryId: 'events' },
  { pattern: /\b(HULU|DISNEY ?\+|DISNEY PLUS|HBO|PARAMOUNT ?\+|PEACOCK|APPLE TV|PRIME VIDEO|TWITCH|CRUNCHYROLL|SLING TV|FUBO|SIRIUSXM|AMC|CINEMARK|REGAL CIN|CINEMA|THEATER|THEATRE|FANDANGO|TOPGOLF|GOLF|COUNTRY CLUB|BOWLING|ARCADE|MUSEUM|AQUARIUM|SIX FLAGS|UNIVERSAL STUDIO)\b/i, categoryId: 'entertainment' },
  { pattern: /\b(ADOBE|MICROSOFT|GITHUB|GOOGLE CLOUD|DROPBOX|NOTION|SLACK|ZOOM|OPENAI|CHATGPT|ANTHROPIC|CLAUDE\.AI|FIGMA|ATLASSIAN|GODADDY|NAMECHEAP|SQUARESPACE|MAILCHIMP|ICLOUD|GOOGLE WORKSPACE|GRAMMARLY|1PASSWORD|NORDVPN)\b/i, categoryId: 'software' },
  // Income — split to the precise Income leaves (#163): payroll signals are a
  // PAYCHECK, interest is interest-income, dividends investment-income,
  // government programs govt-benefits — matching the leaf precision the
  // taxonomy has offered since #63. Descriptor-only like every rule here; the
  // income-vs-expense SIGN is handled downstream by monthlyFlows.
  { pattern: /\b(PAYROLL|DIRECT DEP(OSIT)?|DIR DEP|GUSTO|ADP|PAYCHEX|TRINET|RIPPLING|SALARY)\b/i, categoryId: 'paycheck' },
  { pattern: /\b(INTEREST (EARNED|PAYMENT|PAID|CREDIT))\b/i, categoryId: 'interest-income' },
  { pattern: /\b(DIVIDEND)\b/i, categoryId: 'investment-income' },
  { pattern: /\b(SOCIAL SECURITY|SSA TREAS|UNEMPLOYMENT|SNAP BENEFIT|EDD UI|UI DEPOSIT|UI BENEFIT)\b/i, categoryId: 'govt-benefits' },
  // TAXRFD/CASTTAXRFD: the smashed refund token state tax boards send (#163).
  { pattern: /\b(IRS TREAS 310|TAX ?REF(UND)?|\w*TAXRFD)\b/i, categoryId: 'tax-refund' },
  { pattern: /\b(PENSION|ANNUITY PAYMENT)\b/i, categoryId: 'income' },
  // Bare OVERDRAFT → fees. "OVERDRAFT TRANSFER …" is claimed earlier in
  // KNOWN_MERCHANTS (O.20j R6) so brokerage coverage never reaches this rule.
  { pattern: /\b(OVERDRAFT|NSF FEE|INSUFFICIENT FUNDS|RETURNED ITEM FEE|LATE FEE|SERVICE CHARGE|MONTHLY (MAINTENANCE|SERVICE) FEE|MAINTENANCE FEE|ANNUAL FEE|FOREIGN TRANSACTION FEE|ATM FEE|WIRE FEE|FINANCE CHARGE|INTEREST CHARGE)\b/i, categoryId: 'fees' },
  // Financial / giving. (The tax-refund rule above catches 'IRS TREAS 310' /
  // 'TAX REF' first, so this taxes rule only sees payments TO tax authorities.)
  // Property tax has its own Home leaf — before the general taxes rule (#163).
  { pattern: /\b(PROP(ERTY)? TAX)\b/i, categoryId: 'property-tax' },
  { pattern: /\b(IRS|TAXES?|TURBOTAX|H&R BLOCK|TAX PREP|DEPT OF REVENUE|FRANCHISE TAX)\b/i, categoryId: 'taxes' },
  // Housing obligations the benchmark surfaced (#163): HOA dues; rent through
  // property-management portals.
  // Dues-context REQUIRED (critic P1-3): bare \bHOA\b hit 'PHO HOA' (a real
  // restaurant chain) and 'HOA BINH MARKET'.
  { pattern: /\bHOA (DUES?|FEES?|PAYMENTS?|ASSESSMENTS?)\b/i, categoryId: 'hoa' },
  { pattern: /\b(PROP(ERTY)? (MGMT|MANAGEMENT)\b.*\bRENT|RENT\b.*\bPROP(ERTY)? (MGMT|MANAGEMENT))\b/i, categoryId: 'rent' },
  // Brokerages / robo-advisors / crypto exchanges → investment (#163).
  // FIDELITY must be qualified (critic P1-3): 'FIDELITY NATIONAL TITLE' is an
  // escrow company — a $1,500 closing payment is not an investment.
  { pattern: /\b(VANGUARD|FIDELITY INVEST\w*|FID BKG|CHARLES SCHWAB|SCHWAB|COINBASE|ROBINHOOD|E\*?TRADE|WEALTHFRONT|BETTERMENT|ACORNS|MERRILL)\b/i, categoryId: 'investment' },
  // Credit bureaus / monitoring → financial; legal services → legal (#163).
  { pattern: /\b(EXPERIAN|EQUIFAX|TRANSUNION|CREDIT KARMA|CREDIT ?REPORT)\b/i, categoryId: 'financial' },
  { pattern: /\b(LEGALZOOM|ROCKET LAWYER|NOTARY|LAW OFFICE|ATTORNEY)\b/i, categoryId: 'legal' },
  // Personal-loan payments (SoFi et al.) → loan-payment (#163).
  { pattern: /\b(SOFI\b.*\bLOAN|LOAN (PMT|PAYMENT)|LENDING ?CLUB|UPSTART|AVANT\b|BEST ?EGG)\b/i, categoryId: 'loan-payment' },
  // Ad platforms → advertising (#163).
  { pattern: /\b(FACEBK ADS|FB\.ME\/ADS|GOOGLE ?\*?ADS\w*|META ADS|TIKTOK ADS|LINKEDIN ADS)\b/i, categoryId: 'advertising' },
  // Student-loan servicers (#163) — a high-value recurring row with no prior rule.
  { pattern: /\b(NELNET|MOHELA|NAVIENT|SALLIE MAE|GREAT LAKES ED|FEDLOAN|AIDVANTAGE|STUDENT LN|STUDENT LOAN)\b/i, categoryId: 'loan-payment' },
  // Buy-now-pay-later installments are purchases being paid off (#163).
  { pattern: /\b(AFFIRM|KLARNA|AFTERPAY|SEZZLE)\b/i, categoryId: 'shopping' },
  // Self-storage (#163).
  { pattern: /\b(PUBLIC STORAGE|EXTRA SPACE STO|CUBESMART|LIFE STORAGE|U-?HAUL STORAGE)\b/i, categoryId: 'storage' },
  // Office-supply retailers → their own leaf (#163); shipping/coworking stay business.
  { pattern: /\b(STAPLES|OFFICE DEPOT|OFFICEMAX)\b/i, categoryId: 'office-supplies' },
  { pattern: /\b(FEDEX|UPS STORE|USPS|WEWORK)\b/i, categoryId: 'business' },
  // Goodwill RETAIL (a thrift-store purchase) is shopping for clothes, not a
  // donation (#163) — must precede the charity rule's bare GOODWILL.
  // 'GOODWILL INDUSTRIES #NN' / 'GOODWILL #NN' are the common register forms
  // (critic P2-7) — all retail; a bare GOODWILL (a donation) stays charity below.
  { pattern: /\bGOODWILL (STORE|RETAIL|OUTLET|INDUSTRIES)\b|\bGOODWILL #?\d/i, categoryId: 'clothing' },
  // Churches/tithing (#163): CHURCH'S CHICKEN is a KNOWN_MERCHANT (fast-food)
  // and never reaches this rule.
  // Bare CHURCH removed (critic P1-3): 'FALLS CHURCH' is a Virginia CITY that
  // rides every local descriptor — only a denominational phrase or 'CHURCH OF'
  // qualifies.
  { pattern: /\b(RED CROSS|GOFUNDME|UNICEF|SALVATION ARMY|GOODWILL|CHARITY|DONATION|UNITED WAY|ST JUDE|HABITAT FOR|NONPROFIT|TITHE(LY)?|CHURCH OF|(BAPTIST|METHODIST|LUTHERAN|CATHOLIC|PRESBYTERIAN|COMMUNITY|CHRISTIAN|BIBLE|EPISCOPAL) CHURCH|MINISTRIES)\b/i, categoryId: 'charity' },
  { pattern: /\b(1-?800-?FLOWERS|TELEFLORA|HALLMARK|EDIBLE ARRANG\w*|FLORIST|FLOWER SHOP)\b/i, categoryId: 'gifts' },
];

/**
 * ── Category-vocabulary tier (the "the category word is literally in the name"
 * fallback). Runs LAST — only after KNOWN_MERCHANTS and GENERIC_CATEGORY_RULES have
 * both missed — so it never changes a merchant or keyword we already resolve, and
 * aggregates (Zelle/Venmo/checks) have already returned above and can't reach it.
 *
 * It catches the long tail the fixed allowlist can't enumerate by matching the
 * descriptor's OWN tokens against the category taxonomy's vocabulary — the
 * systematic version of the scattered keyword rules above, and the answer to
 * "many transactions literally have the category in the name" (golf, electricity,
 * life insurance). Three moves, in order:
 *   1. EXPAND common bank abbreviations on an EXACT token (GLF→GOLF, ELEC→ELECTRIC,
 *      INS→INSURANCE, PHARM→PHARMACY, PMT→PAYMENT).
 *   2. DE-CONCATENATE a space-stripped token against a small word set — real feeds
 *      routinely drop the spaces, and \b-anchored keyword rules can't see inside a
 *      smashed token (the reason 'LIFEINSURANCE' missed \bINSURANCE\b). Both halves
 *      must be dictionary words, so it recombines category words with their
 *      qualifiers/glue and never invents a split: LIFEINSURANCE→LIFE INSURANCE,
 *      WATERBILL→WATER BILL, AUTOINSURANCE→AUTO INSURANCE, PARKINGMETER→PARKING METER.
 *   3. MATCH the resulting token stream (single tokens + adjacent 2-grams) against
 *      CATEGORY_VOCAB, ordered specific→generic (natural-gas before a bare gas
 *      phrase; the insurance sub-lines before generic insurance).
 *
 * Confidence is GENERIC-tier (auto-file with the subtle "AI" badge, never silent),
 * and ONLY unambiguous category words are listed — bare ambiguous tokens (GAS =
 * gasoline-vs-utility, WATER = park-vs-utility, MOBILE = phone-vs-"mobile deposit")
 * are deliberately mapped only inside a disambiguating phrase — so a mis-map is both
 * rare and one tap for the user to correct.
 */
export const VOCAB_CONFIDENCE_BPS = 7500;

/** Whole-token abbreviation/synonym expansions (applied only to an EXACT token). */
const TOKEN_EXPANSIONS: Readonly<Record<string, string>> = {
  GLF: 'GOLF',
  ELEC: 'ELECTRIC', ELECT: 'ELECTRIC', ELECTRICITY: 'ELECTRIC', ELE: 'ELECTRIC', ELC: 'ELECTRIC',
  INS: 'INSURANCE', INSUR: 'INSURANCE', INSCE: 'INSURANCE',
  PHARM: 'PHARMACY', PHARMA: 'PHARMACY', RX: 'PHARMACY',
  PMT: 'PAYMENT', PYMT: 'PAYMENT', PYMNT: 'PAYMENT', PMNT: 'PAYMENT', PMTS: 'PAYMENT',
  UTIL: 'UTILITY', UTILS: 'UTILITY', UTILITIES: 'UTILITY',
  VET: 'VETERINARY',
};

/**
 * Words the de-concatenator may split a smashed token into. BOTH halves must be in
 * this set (or expand into it), so it only recombines category words with their
 * qualifiers/glue — never invents a split. Kept short and unambiguous on purpose.
 */
const SEGMENT_WORDS: ReadonlySet<string> = new Set([
  'LIFE', 'AUTO', 'CAR', 'HEALTH', 'HOME', 'HOMEOWNERS', 'RENTERS', 'PET', 'DENTAL', 'VISION',
  'TERM', 'WHOLE', 'WATER', 'SEWER', 'SEWAGE', 'GAS', 'ELECTRIC', 'POWER', 'ENERGY', 'TRASH',
  'GARBAGE', 'SANITATION', 'INSURANCE', 'BILL', 'PAYMENT', 'GOLF', 'PARKING', 'METER',
  'PHARMACY', 'MEDICAL', 'MORTGAGE', 'NATURAL', 'COUNTRY', 'CLUB', 'DRIVING', 'RANGE',
]);

/** Ordered specific→generic; `phrase` is 1–2 (post-expansion) tokens. First hit wins. */
const CATEGORY_VOCAB: readonly { phrase: readonly string[]; categoryId: string }[] = [
  // Utilities — the disambiguated phrases beat the bare/electric token below.
  { phrase: ['NATURAL', 'GAS'], categoryId: 'natural-gas' },
  { phrase: ['GAS', 'BILL'], categoryId: 'natural-gas' },
  { phrase: ['GAS', 'UTILITY'], categoryId: 'natural-gas' },
  { phrase: ['GAS', 'COMPANY'], categoryId: 'natural-gas' },
  { phrase: ['WATER', 'BILL'], categoryId: 'water' },
  { phrase: ['WATER', 'UTILITY'], categoryId: 'water' },
  { phrase: ['WATER', 'SEWER'], categoryId: 'water' },
  { phrase: ['WATER', 'DEPARTMENT'], categoryId: 'water' },
  { phrase: ['SEWER'], categoryId: 'water' },
  { phrase: ['SEWAGE'], categoryId: 'water' },
  { phrase: ['TRASH'], categoryId: 'trash' },
  { phrase: ['GARBAGE'], categoryId: 'trash' },
  { phrase: ['SANITATION'], categoryId: 'trash' },
  { phrase: ['ELECTRIC'], categoryId: 'electricity' },
  // Insurance — sub-lines before generic insurance.
  { phrase: ['LIFE', 'INSURANCE'], categoryId: 'life-insurance' },
  { phrase: ['TERM', 'INSURANCE'], categoryId: 'life-insurance' },
  { phrase: ['AUTO', 'INSURANCE'], categoryId: 'auto-insurance' },
  { phrase: ['CAR', 'INSURANCE'], categoryId: 'auto-insurance' },
  { phrase: ['HEALTH', 'INSURANCE'], categoryId: 'health-insurance' },
  { phrase: ['MEDICAL', 'INSURANCE'], categoryId: 'health-insurance' },
  { phrase: ['DENTAL', 'INSURANCE'], categoryId: 'dental-insurance' },
  { phrase: ['VISION', 'INSURANCE'], categoryId: 'vision-insurance' },
  { phrase: ['INSURANCE'], categoryId: 'insurance' },
  // Recreation / services / health.
  { phrase: ['DRIVING', 'RANGE'], categoryId: 'entertainment' },
  { phrase: ['COUNTRY', 'CLUB'], categoryId: 'entertainment' },
  { phrase: ['GOLF'], categoryId: 'entertainment' },
  { phrase: ['PHARMACY'], categoryId: 'pharmacy' },
  { phrase: ['PARKING'], categoryId: 'parking' },
  { phrase: ['VETERINARY'], categoryId: 'pets' },
  { phrase: ['DENTAL'], categoryId: 'dental' },
  { phrase: ['DENTIST'], categoryId: 'dental' },
];

/** Split a smashed alpha token into two dictionary words, or null. */
function segmentToken(tok: string): string[] | null {
  for (let i = 3; i <= tok.length - 3; i++) {
    const a = tok.slice(0, i);
    const b = tok.slice(i);
    if (!SEGMENT_WORDS.has(a)) continue;
    if (SEGMENT_WORDS.has(b)) return [a, b];
    const bExp = TOKEN_EXPANSIONS[b];
    if (bExp && SEGMENT_WORDS.has(bExp)) return [a, bExp];
  }
  return null;
}

/** Tokenize + expand abbreviations + de-concatenate → the token stream to match. */
function expandTokens(raw: string): string[] {
  const rawTokens = raw.toUpperCase().split(/[^A-Z0-9&]+/).filter(Boolean);
  const out: string[] = [];
  for (const tok of rawTokens) {
    const exp = TOKEN_EXPANSIONS[tok];
    if (exp) {
      out.push(exp);
      continue;
    }
    if (/^[A-Z]+$/.test(tok) && tok.length >= 8) {
      const seg = segmentToken(tok);
      if (seg) {
        out.push(...seg);
        continue;
      }
    }
    out.push(tok);
  }
  return out;
}

/**
 * Final deterministic tier: match a descriptor's own (expanded, de-concatenated)
 * tokens against the category vocabulary. Returns null when no category word is
 * present — the row then falls through to review, unchanged.
 */
export function matchCategoryVocabulary(
  rawDescriptor: string,
): { categoryId: string; confidenceBps: number } | null {
  const tokens = expandTokens(rawDescriptor);
  if (tokens.length === 0) return null;
  const present = new Set(tokens);
  for (const { phrase, categoryId } of CATEGORY_VOCAB) {
    if (phrase.length === 1) {
      if (present.has(phrase[0])) return { categoryId, confidenceBps: VOCAB_CONFIDENCE_BPS };
    } else {
      for (let i = 0; i + 1 < tokens.length; i++) {
        if (tokens[i] === phrase[0] && tokens[i + 1] === phrase[1]) {
          return { categoryId, confidenceBps: VOCAB_CONFIDENCE_BPS };
        }
      }
    }
  }
  return null;
}

/** Aggregate canonical names that exist outside the ambiguous block too. */
const AGGREGATE_CANONICALS = new Set(['ATM Withdrawal', 'Account Transfer', 'Card Payment', 'Unknown Merchant']);

/**
 * Is this canonical merchant name an aggregate pseudo-merchant? Used by the
 * RULE READ PATH as defense in depth: even a rule row written before the
 * creation-time guard existed must never steer suggestions for an aggregate.
 */
export function isAggregateCanonical(canonical: string): boolean {
  // Case-insensitive (#250 critic F3): this is defense in depth on every path
  // that consults it (rule reads, anomaly radar, merchant lens), and a stale or
  // case-variant row must not slip past the guard on a casing technicality.
  // Pipeline-minted canonicals are exact-case, so this only widens the net.
  if (AGGREGATE_CANONICALS.has(canonical)) return true;
  const lower = canonical.toLowerCase();
  return (
    KNOWN_MERCHANTS.some((m) => m.aggregate && m.canonical.toLowerCase() === lower) ||
    [...AGGREGATE_CANONICALS].some((c) => c.toLowerCase() === lower)
  );
}

const DEFAULT_KNOWN_CONFIDENCE = 9600;
const UNKNOWN_CONFIDENCE = 5000;
/** Toast ("TST" prefix) restaurant-POS prior — auto-file band, visible AI badge. */
export const TOAST_PRIOR_CONFIDENCE_BPS = 8000;

/** Trailing-location state codes (feed suffixes like "SEATTLE WA"). */
const US_STATE_RE =
  /\s+(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|WA|WV|WI|WY|DC)$/i;

/** Generic cleanup for descriptors we have no pattern for. */
export function cleanDescriptor(raw: string): string {
  let s = stripBankNoise(raw);
  s = s.replace(/^(SQ \*|TST\*\s*|PAYPAL \*|PP\*|PY \*|DD \*|POS \d+ |PADDLE\.NET\*\s*|FS \*|CKE\*|IN \*|SP \* ?)/i, '');
  s = s.replace(/\b\d{3}-\d{3}-\d{4}\b/g, ''); // phone numbers
  s = s.replace(/\b8\d{2}-[A-Z]+\b/gi, ''); // 800-COMCAST style
  s = s.replace(/[#*]\s*\d+/g, ''); // store numbers
  s = s.replace(/\b(POS|TERM|REF)\s*\d+\b/gi, '');
  s = s.replace(/\b\d{4,}\b/g, ''); // long digit runs
  s = s.replace(/\*/g, ' '); // processor asterisks are never part of a name (3a)
  s = s.replace(/\s{2,}/g, ' ').replace(/[*#-]+$/g, '').trim();
  // Trailing "CITY ST" location suffix (Phase 3a): the same store appears as
  // "X", "X SEATTLE WA", "X WA" across feeds — one identity, not three. Greedy
  // state strip first (never eats a name token: 'OLD NAVY CA' → 'Old Navy');
  // then ONE city token, only when a state was just stripped AND ≥2 name tokens
  // remain — so 'SEAWOLF BAKERS SEATTLE WA' → 'Seawolf Bakers' while a 2-token
  // name + bare state ('OLD NAVY CA') keeps its full name.
  const afterState = s.replace(US_STATE_RE, '');
  if (afterState !== s && afterState.trim().length > 0) {
    s = afterState.trim();
    const tokens = s.split(/\s+/);
    if (tokens.length >= 3) s = tokens.slice(0, -1).join(' ');
  }
  // Title-case
  return s
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function toMatch(m: KnownMerchant): MerchantMatch {
  return {
    canonical: m.canonical,
    categoryId: m.categoryId,
    confidenceBps: m.confidenceBps ?? DEFAULT_KNOWN_CONFIDENCE,
    known: true,
    aggregate: m.aggregate ?? AGGREGATE_CANONICALS.has(m.canonical),
  };
}

function matchKnown(s: string): MerchantMatch | null {
  for (const m of KNOWN_MERCHANTS) {
    if (m.pattern.test(s)) return toMatch(m);
  }
  return null;
}

/**
 * Second-chance table match on the CLEANED string — accepted ONLY when the
 * pattern consumes the ENTIRE cleaned name. 'SQ *STARBUCKS #4471' cleans to
 * 'Starbucks' (full match → Starbucks), while 'SQ *NETFLIX AND CHILL BAR'
 * cleans to 'Netflix And Chill Bar' (prefix-only match → REJECTED, stays a
 * local merchant). Keeps the fix-doc convergence without reopening the
 * anchored-pattern leak the cycle-2 critic locked (critic2-pipeline.test.ts).
 */
function matchKnownFull(cleaned: string): MerchantMatch | null {
  for (const m of KNOWN_MERCHANTS) {
    const hit = cleaned.match(m.pattern);
    if (hit && hit.index === 0 && hit[0].length === cleaned.length) return toMatch(m);
  }
  return null;
}

export function normalizeMerchant(rawDescriptor: string): MerchantMatch {
  const onRaw = matchKnown(rawDescriptor);
  if (onRaw) return onRaw;
  // Bank-channel prefixes ("PURCHASE AUTHORIZED ON 06/12 …") hide the brand
  // from every ^-anchored pattern — try the table again on the stripped form
  // (#163). Raw is tried FIRST, so any descriptor the table already resolves
  // is untouched; demo/seed descriptors carry no bank prefixes.
  const stripped = stripBankNoise(rawDescriptor);
  if (stripped !== rawDescriptor.trim()) {
    const onStripped = matchKnown(stripped);
    if (onStripped) return onStripped;
  }
  const cleaned = cleanDescriptor(rawDescriptor);
  // Second chance on the CLEANED string (Phase 3a): a processor prefix or store
  // suffix hid a known brand from the ^-anchored table — 'SQ *STARBUCKS #4471'
  // cleans to 'Starbucks' and hits /^STARBUCKS/. Raw is tried FIRST so specific
  // prefixed entries (SQ *BLUE BOTTLE) keep winning; the cleaned match must
  // consume the WHOLE cleaned name (see matchKnownFull) so prefixed locals
  // containing a brand word never leak into the brand.
  if (cleaned) {
    const onCleaned = matchKnownFull(cleaned);
    if (onCleaned) return onCleaned;
  }
  // Generic keyword fallback: a real-world merchant name we can categorize even
  // without a specific pattern (#63). Auto-files (with an "AI" badge), not silent.
  for (const g of GENERIC_CATEGORY_RULES) {
    if (g.pattern.test(rawDescriptor)) {
      return {
        canonical: cleaned || 'Unknown Merchant',
        categoryId: g.categoryId,
        confidenceBps: GENERIC_CONFIDENCE_BPS,
        known: true,
        aggregate: false,
      };
    }
  }
  // Final deterministic tier: the category word is literally in the descriptor
  // (golf, electricity, LIFEINSURANCE, WATERBILL, ELEC PMT) — resolve it from the
  // taxonomy vocabulary instead of leaving an obvious row for manual review. Runs
  // on the RAW descriptor (its own tokenizer handles abbreviations + smashed
  // tokens) so nothing the KNOWN/GENERIC layers already answered is affected.
  const vocab = matchCategoryVocabulary(rawDescriptor);
  if (vocab) {
    return {
      canonical: cleaned || 'Unknown Merchant',
      categoryId: vocab.categoryId,
      confidenceBps: vocab.confidenceBps,
      known: true,
      aggregate: false,
    };
  }
  // Processor priors (#163): some payment processors serve exactly one merchant
  // vertical, so the PREFIX itself is strong category evidence once every
  // specific tier has missed. Toast (TST*) is restaurant POS; Paddle
  // (PADDLE.NET*) processes software/digital products only. File in the
  // AI-badge band (auto-filed but visibly correctable, never silent). Runs
  // AFTER vocab so a descriptor carrying an explicit category word keeps the
  // more specific answer, and only when a real name survived cleaning (a bare
  // 'TST*' stays review).
  if (/^TST\*|^TOAST\b/i.test(stripped) && cleaned) {
    return {
      canonical: cleaned,
      categoryId: 'dining',
      confidenceBps: TOAST_PRIOR_CONFIDENCE_BPS,
      known: false,
      aggregate: false,
    };
  }
  if (/^PADDLE\.NET|^FS \*|^FASTSPRING/i.test(stripped) && cleaned) {
    return {
      canonical: cleaned,
      categoryId: 'software',
      confidenceBps: TOAST_PRIOR_CONFIDENCE_BPS,
      known: false,
      aggregate: false,
    };
  }
  return {
    canonical: cleaned || 'Unknown Merchant',
    categoryId: 'uncategorized',
    confidenceBps: UNKNOWN_CONFIDENCE,
    known: false,
    aggregate: !cleaned,
  };
}
