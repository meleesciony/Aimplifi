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

export interface MerchantMatch {
  canonical: string;
  categoryId: string;
  /** 0–10000. Known merchants ≥ 9000; ambiguous kinds (Zelle, checks) lower. */
  confidenceBps: number;
  known: boolean;
}

interface KnownMerchant {
  pattern: RegExp;
  canonical: string;
  categoryId: string;
  confidenceBps?: number; // default 9600
}

/** Ordered: first match wins. Specific before generic. */
export const KNOWN_MERCHANTS: KnownMerchant[] = [
  // Square / Toast / processor-prefixed locals
  { pattern: /^SQ \*BLUE BOTTLE/i, canonical: 'Blue Bottle Coffee', categoryId: 'dining' },
  { pattern: /^SQ \*PONCE CITY DONUTS/i, canonical: 'Ponce City Donuts', categoryId: 'dining' },
  { pattern: /^TST\*\s*HATTIE B/i, canonical: "Hattie B's", categoryId: 'dining' },
  { pattern: /^TST\*\s*FOX BROS/i, canonical: 'Fox Bros BBQ', categoryId: 'dining' },
  // Amazon family — Mktp, retail, refunds
  { pattern: /^AMZN Mktp/i, canonical: 'Amazon', categoryId: 'shopping' },
  { pattern: /^AMAZON(\.COM)?/i, canonical: 'Amazon', categoryId: 'shopping' },
  // PayPal pass-throughs
  { pattern: /^PAYPAL \*SPOTIFY/i, canonical: 'Spotify', categoryId: 'entertainment' },
  { pattern: /^PAYPAL \*ETSY/i, canonical: 'Etsy', categoryId: 'shopping' },
  // Airport POS
  { pattern: /^HMSHOST-/i, canonical: 'Airport Dining', categoryId: 'dining' },
  // Costco: gas vs warehouse are DIFFERENT merchants (and categories)
  { pattern: /^COSTCO GAS #/i, canonical: 'Costco Gas', categoryId: 'fuel' },
  { pattern: /^COSTCO WHSE #/i, canonical: 'Costco', categoryId: 'groceries' },
  // Rideshare / delivery
  { pattern: /^UBER \*\s*EATS/i, canonical: 'Uber Eats', categoryId: 'dining' },
  { pattern: /^UBER \*\s*TRIP/i, canonical: 'Uber', categoryId: 'transport' },
  { pattern: /^LYFT \*/i, canonical: 'Lyft', categoryId: 'transport' },
  // Subscriptions
  { pattern: /^NETFLIX/i, canonical: 'Netflix', categoryId: 'entertainment' },
  { pattern: /^APPLE\.COM\/BILL/i, canonical: 'Apple', categoryId: 'software' },
  { pattern: /^GOOGLE \*YOUTUBEPREMIUM/i, canonical: 'YouTube Premium', categoryId: 'entertainment' },
  { pattern: /^LA FITNESS/i, canonical: 'LA Fitness', categoryId: 'fitness' },
  { pattern: /^HELLOFRESH/i, canonical: 'HelloFresh', categoryId: 'groceries' },
  { pattern: /^GEICO/i, canonical: 'Geico', categoryId: 'insurance' },
  { pattern: /^COMCAST|XFINITY/i, canonical: 'Xfinity', categoryId: 'utilities' },
  // Groceries / big box
  { pattern: /^KROGER #/i, canonical: 'Kroger', categoryId: 'groceries' },
  { pattern: /^PUBLIX/i, canonical: 'Publix', categoryId: 'groceries' },
  { pattern: /^TRADER JOE/i, canonical: "Trader Joe's", categoryId: 'groceries' },
  { pattern: /^WM SUPERCENTER/i, canonical: 'Walmart', categoryId: 'shopping' },
  { pattern: /^TARGET T-/i, canonical: 'Target', categoryId: 'shopping' },
  // Dining chains
  { pattern: /^CHICK-FIL-A/i, canonical: 'Chick-fil-A', categoryId: 'dining' },
  { pattern: /^MCDONALD'?S/i, canonical: "McDonald's", categoryId: 'dining' },
  { pattern: /^STARBUCKS/i, canonical: 'Starbucks', categoryId: 'dining' },
  { pattern: /^WAFFLE HOUSE/i, canonical: 'Waffle House', categoryId: 'dining' },
  // Fuel
  { pattern: /^SHELL OIL/i, canonical: 'Shell', categoryId: 'fuel' },
  { pattern: /^QT \d/i, canonical: 'QuikTrip', categoryId: 'fuel' },
  { pattern: /^CHEVRON/i, canonical: 'Chevron', categoryId: 'fuel' },
  // Travel
  { pattern: /^DELTA AIR/i, canonical: 'Delta Air Lines', categoryId: 'travel' },
  { pattern: /^MARRIOTT/i, canonical: 'Marriott', categoryId: 'travel' },
  { pattern: /^AIRBNB/i, canonical: 'Airbnb', categoryId: 'travel' },
  // Health
  { pattern: /^CVS\/PHARM/i, canonical: 'CVS Pharmacy', categoryId: 'health' },
  { pattern: /^WALGREENS/i, canonical: 'Walgreens', categoryId: 'health' },
  // Home improvement
  { pattern: /^HOME DEPOT/i, canonical: 'Home Depot', categoryId: 'household' },
  { pattern: /^LOWES/i, canonical: "Lowe's", categoryId: 'household' },
  { pattern: /^SPIRIT HALLOWEEN/i, canonical: 'Spirit Halloween', categoryId: 'shopping' },
  // Banking / income / obligations
  { pattern: /^ACH DEPOSIT .*PAYROLL/i, canonical: 'Acme Analytics (Payroll)', categoryId: 'income' },
  { pattern: /^ACH WITHDRAWAL .*RENT/i, canonical: 'Peachtree Properties (Rent)', categoryId: 'rent' },
  { pattern: /^ACH WITHDRAWAL CARMAX/i, canonical: 'CarMax Auto Finance', categoryId: 'auto-loan' },
  { pattern: /^STORE CARD PURCHASE/i, canonical: 'Store Card Purchase', categoryId: 'shopping', confidenceBps: 6000 },
  { pattern: /^ATM WITHDRAWAL/i, canonical: 'ATM Withdrawal', categoryId: 'cash' },
  // Transfers (also caught by transfer detection; belt and suspenders)
  { pattern: /^ONLINE TRANSFER/i, canonical: 'Account Transfer', categoryId: 'transfer' },
  { pattern: /EPAY|PAYMENT THANK YOU|CARD PAYMENT/i, canonical: 'Card Payment', categoryId: 'transfer' },
  // Genuinely ambiguous — must go to review
  { pattern: /^ZELLE PAYMENT/i, canonical: 'Zelle Payment', categoryId: 'uncategorized', confidenceBps: 4000 },
  { pattern: /^CHECK #/i, canonical: 'Check', categoryId: 'uncategorized', confidenceBps: 4000 },
];

const DEFAULT_KNOWN_CONFIDENCE = 9600;
const UNKNOWN_CONFIDENCE = 5000;

/** Generic cleanup for descriptors we have no pattern for. */
export function cleanDescriptor(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^(SQ \*|TST\*\s*|PAYPAL \*|PP\*|POS \d+ )/i, '');
  s = s.replace(/\b\d{3}-\d{3}-\d{4}\b/g, ''); // phone numbers
  s = s.replace(/\b8\d{2}-[A-Z]+\b/gi, ''); // 800-COMCAST style
  s = s.replace(/[#*]\s*\d+/g, ''); // store numbers
  s = s.replace(/\b(POS|TERM|REF)\s*\d+\b/gi, '');
  s = s.replace(/\b\d{4,}\b/g, ''); // long digit runs
  s = s.replace(/\s{2,}/g, ' ').replace(/[*#-]+$/g, '').trim();
  // Title-case
  return s
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function normalizeMerchant(rawDescriptor: string): MerchantMatch {
  for (const m of KNOWN_MERCHANTS) {
    if (m.pattern.test(rawDescriptor)) {
      return {
        canonical: m.canonical,
        categoryId: m.categoryId,
        confidenceBps: m.confidenceBps ?? DEFAULT_KNOWN_CONFIDENCE,
        known: true,
      };
    }
  }
  const cleaned = cleanDescriptor(rawDescriptor);
  return {
    canonical: cleaned || rawDescriptor,
    categoryId: 'uncategorized',
    confidenceBps: UNKNOWN_CONFIDENCE,
    known: false,
  };
}
