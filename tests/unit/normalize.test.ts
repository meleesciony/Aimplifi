/**
 * Phase 2 acceptance #1: table-driven normalization fixture, ≥40 messy
 * descriptors → expected canonical merchant (docs/EDGE_CASES.md §Categorization).
 */
import { describe, expect, it } from 'vitest';
import { cleanDescriptor, normalizeMerchant } from '@/lib/engine/categorize/normalize';

// [rawDescriptor, expected canonical, expected categoryId]
const FIXTURE: [string, string, string][] = [
  ['SQ *BLUE BOTTLE 0042 OAK', 'Blue Bottle Coffee', 'dining'],
  ['SQ *PONCE CITY DONUTS ATL', 'Ponce City Donuts', 'dining'],
  ["TST* HATTIE BS - ATL", "Hattie B's", 'dining'],
  ['TST* FOX BROS BBQ ATLANTA GA', 'Fox Bros BBQ', 'dining'],
  ['AMZN Mktp US*2K4XY1', 'Amazon', 'shopping'],
  ['AMZN Mktp US*9Q7TR3', 'Amazon', 'shopping'],
  ['AMZN Mktp US*REFUND 2K4XY1', 'Amazon', 'shopping'],
  ['AMAZON.COM*PR1ME 8821', 'Amazon', 'shopping'],
  ['PAYPAL *SPOTIFYUSA', 'Spotify', 'entertainment'],
  ['PAYPAL *ETSY INC SELLER', 'Etsy', 'shopping'],
  ['HMSHOST-ATL-T4-POS118', 'Airport Dining', 'dining'],
  ['COSTCO GAS #1234 ATLANTA', 'Costco Gas', 'fuel'],
  ['COSTCO WHSE #1234 ATLANTA', 'Costco', 'groceries'],
  ['UBER *TRIP HELP.UBER.COM', 'Uber', 'transport'],
  // Phase 3a: food-delivery — the KNOWN entry now agrees with the generic table
  ['UBER *EATS PENDING.UBER.CO', 'Uber Eats', 'food-delivery'],
  ['LYFT *RIDE THU 9PM', 'Lyft', 'transport'],
  ['NETFLIX.COM 866-579-7172', 'Netflix', 'entertainment'],
  ['SPOTIFY USA NEW YORK NY', 'Spotify', 'entertainment'],
  ['APPLE.COM/BILL 866-712-7753', 'Apple', 'software'],
  ['GOOGLE *YOUTUBEPREMIUM g.co', 'YouTube Premium', 'entertainment'],
  ['LA FITNESS MEMBERSHIP DUES', 'LA Fitness', 'fitness'],
  ['HELLOFRESH* 3 MEALS', 'HelloFresh', 'groceries'],
  ['GEICO *AUTO 800-841-3000', 'Geico', 'insurance'],
  ['COMCAST / XFINITY 800-COMCAST', 'Xfinity', 'utilities'],
  ['KROGER #688 ATLANTA GA', 'Kroger', 'groceries'],
  ['PUBLIX SUPER MAR 1893 ATL', 'Publix', 'groceries'],
  ["TRADER JOE S #735", "Trader Joe's", 'groceries'],
  ['WM SUPERCENTER #2841', 'Walmart', 'shopping'],
  ['TARGET T-1893 ATLANTA GAUS', 'Target', 'shopping'],
  ['CHICK-FIL-A #02034', 'Chick-fil-A', 'dining'],
  ["MCDONALD'S F13339", "McDonald's", 'dining'],
  ['STARBUCKS 800-782-7282', 'Starbucks', 'dining'],
  ['WAFFLE HOUSE 1042 ATL', 'Waffle House', 'dining'],
  ['SHELL OIL 57544221800', 'Shell', 'fuel'],
  ['QT 712 OUTSIDE ATLANTA GA', 'QuikTrip', 'fuel'],
  ['CHEVRON 0093552 SMYRNA', 'Chevron', 'fuel'],
  ['DELTA AIR 0062341022334', 'Delta Air Lines', 'travel'],
  ['MARRIOTT ATLANTA MARQ', 'Marriott', 'travel'],
  ['AIRBNB * HM8Q2X PAYMENTS', 'Airbnb', 'travel'],
  ['CVS/PHARM 04733--1100 P', 'CVS Pharmacy', 'health'],
  ['WALGREENS #6332', 'Walgreens', 'health'],
  ['HOME DEPOT #0121', 'Home Depot', 'household'],
  ['LOWES #02748*', "Lowe's", 'household'],
  ['SPIRIT HALLOWEEN 80012', 'Spirit Halloween', 'shopping'],
  ['ACH DEPOSIT ACME ANALYTICS PAYROLL', 'Acme Analytics (Payroll)', 'income'],
  ['ACH WITHDRAWAL PEACHTREE PROPERTIES RENT', 'Peachtree Properties (Rent)', 'rent'],
  ['ACH WITHDRAWAL CARMAX AUTO FIN 4421', 'CarMax Auto Finance', 'auto-loan'],
  ['ATM WITHDRAWAL 00482 PEACHTREE ST', 'ATM Withdrawal', 'cash'],
  ['ONLINE TRANSFER TO HIGH-YIELD SAVINGS X9907', 'Account Transfer', 'transfer'],
  ['CHASE EPAY SAPPHIRE', 'Card Payment', 'transfer'],
  ['PAYMENT THANK YOU', 'Card Payment', 'transfer'],
  ['GOOGLE *ONE g.co/helppay', 'Google One', 'software'], // #161 owner-reported miss
  ['ROUND1 AM', 'Round1', 'entertainment'], // #161 owner-reported miss (arcade)
];

describe('merchant normalization fixture (≥40 rows, table-driven)', () => {
  it(`fixture has ${FIXTURE.length} rows (≥ 40)`, () => {
    expect(FIXTURE.length).toBeGreaterThanOrEqual(40);
  });

  it.each(FIXTURE)('"%s" → %s (%s)', (raw, canonical, categoryId) => {
    const m = normalizeMerchant(raw);
    expect(m.canonical).toBe(canonical);
    expect(m.categoryId).toBe(categoryId);
    expect(m.known).toBe(true);
    expect(m.confidenceBps).toBeGreaterThanOrEqual(9000);
  });

  it('Google One + Round1 map across their descriptor variants (#161)', () => {
    for (const raw of ['GOOGLE ONE', 'GOOGLE *ONE', 'GOOGLE ONE 1234567']) {
      expect(normalizeMerchant(raw).categoryId).toBe('software');
    }
    for (const raw of ['ROUND1', 'ROUND1 AM', 'round1am', 'ROUND 1']) {
      const m = normalizeMerchant(raw);
      expect(m.categoryId).toBe('entertainment');
      expect(m.canonical).toBe('Round1');
    }
    // and they do NOT over-match lookalikes
    expect(normalizeMerchant('ROUNDTABLE PIZZA').categoryId).not.toBe('entertainment');
    expect(normalizeMerchant('GROUND CONTROL COFFEE').canonical).toBe('Ground Control Coffee');
  });

  it('Costco Gas and Costco warehouse are DISTINCT merchants', () => {
    expect(normalizeMerchant('COSTCO GAS #1234 ATLANTA').canonical).not.toBe(
      normalizeMerchant('COSTCO WHSE #1234 ATLANTA').canonical,
    );
  });

  it('genuinely ambiguous descriptors stay low-confidence: Zelle, checks', () => {
    expect(normalizeMerchant('ZELLE PAYMENT TO J. PARK').confidenceBps).toBeLessThan(7000);
    expect(normalizeMerchant('CHECK #1042').confidenceBps).toBeLessThan(7000);
  });

  it('unknown descriptors get cleaned, title-cased candidates at low confidence', () => {
    const m = normalizeMerchant('SQ *MYSTERY VENDOR 0099 ATL');
    expect(m.known).toBe(false);
    expect(m.confidenceBps).toBeLessThan(7000);
    expect(m.canonical).toBe('Mystery Vendor Atl');
  });

  it('cleanDescriptor strips prefixes, store numbers, phones, POS ids', () => {
    expect(cleanDescriptor('SQ *CORNER CAFE 0042 OAK')).toBe('Corner Cafe Oak');
    expect(cleanDescriptor('PAYPAL *SOMESHOP 866-579-7172')).toBe('Someshop');
  });
});

describe('generic keyword categorization for real-world merchants (DECISIONS #63)', () => {
  // Descriptors NOT in the specific KNOWN_MERCHANTS table — the layer that broadens
  // auto-categorization for a real bank feed. Each should auto-file (conf ≥ 7000).
  const cases: [string, string][] = [
    ['CHEWY.COM 800-555-1234', 'pets'],
    ['PLANET FITNESS CLUB FEE', 'fitness'],
    ['SOUTHWEST AIRLINES 5267', 'air-travel'],
    ['HILTON GARDEN INN ATLANTA', 'hotel'],
    ['HERTZ RENT A CAR', 'rental-car'],
    ['VERIZON WIRELESS PMT', 'phone'],
    ['GEORGIA POWER BILL', 'electricity'],
    ['AMC THEATRES 0456', 'entertainment'],
    // Insurance CARRIERS (the premium) file under the insurance family, NOT the
    // medical-service category — a Delta Dental premium is dental insurance, not a
    // dentist visit (owner decision, DECISIONS #115). health-insurance = "medical".
    ['DELTA DENTAL OF GA', 'dental-insurance'],
    ['DELTA DENTAL OF GA PREMIUM', 'dental-insurance'],
    ['VSP VISION 800-877-7195', 'vision-insurance'],
    ['EYEMED VISION CARE', 'vision-insurance'],
    ['BCBS OF GEORGIA PREMIUM', 'health-insurance'],
    ['AETNA HEALTH PREMIUM', 'health-insurance'],
    // …but an actual dental SERVICE provider still files under dental: the carrier
    // rules require a carrier name or an explicit INS/PPO/PREMIUM token, so a
    // plain dentist's office is untouched.
    ['GENTLE DENTAL CARE ATLANTA', 'dental'],
    ['JOES PIZZA NYC', 'dining'],
    ['DOORDASH*WENDYS', 'food-delivery'],
    // Income + bank-fee signals that previously fell through to manual review.
    ['GUSTO PAYROLL 9X8Y7Z DIRECT DEP', 'income'],
    ['INTEREST EARNED', 'income'],
    ['OVERDRAFT FEE', 'fees'],
    ['NORDSTROM RACK #12', 'clothing'],
    ['IKEA ATLANTA', 'furnishings'],
    // Golf: "X GOLF COURSE/CLUB" is recreation (entertainment), consistent with
    // TOPGOLF already mapping there; golf retailers stay hobbies (DECISIONS #109).
    ['NORTHWEST GOLF COURSE', 'entertainment'],
    ['BEAR CREEK GOLF CLUB ATL', 'entertainment'],
    ['EAGLE WATCH COUNTRY CLUB', 'entertainment'],
    ['GOLF GALAXY #017 KENNESAW', 'hobbies'],
    ['PGA TOUR SUPERSTORE 4521', 'hobbies'],
  ];
  for (const [raw, categoryId] of cases) {
    it(`"${raw}" -> ${categoryId}, auto-filed`, () => {
      const m = normalizeMerchant(raw);
      expect(m.categoryId).toBe(categoryId);
      expect(m.confidenceBps).toBeGreaterThanOrEqual(7000);
      expect(m.aggregate).toBe(false);
    });
  }

  it('a descriptor with no known merchant AND no keyword stays uncategorized', () => {
    const m = normalizeMerchant('ACME WIDGETS LLC 7781');
    expect(m.categoryId).toBe('uncategorized');
    expect(m.known).toBe(false);
  });
});

describe('category-vocabulary tier — "the category word is literally in the name"', () => {
  // The deterministic long-tail catch: abbreviations, space-stripped tokens, and
  // bare category words that the fixed merchant/keyword allowlists cannot enumerate.
  // Every row here previously fell to uncategorized → manual review.
  const cases: [string, string][] = [
    // user-reported forms
    ['GLF', 'entertainment'], // abbreviation → GOLF
    ['GLF COURSE 4471', 'entertainment'],
    ['ELECTRICITY', 'electricity'],
    ['ELEC PMT', 'electricity'], // abbreviations: ELEC→ELECTRIC, PMT→PAYMENT
    ['LIFEINSURANCE', 'life-insurance'], // space-stripped: \bINSURANCE\b could never fire here
    ['WATERBILL', 'water'], // de-concatenation → WATER BILL
    ['DRIVING RANGE LLC', 'entertainment'],
    // concatenation splitting across the insurance family
    ['AUTOINSURANCE', 'auto-insurance'],
    ['CAR INSURANCE PMT', 'auto-insurance'],
    ['HEALTHINS', 'health-insurance'],
    ['DENTAL INSURANCE', 'dental-insurance'],
    // utility companies with no category word (brand/acronym)
    ['SCE', 'electricity'],
    ['CONED', 'electricity'],
    ['PG&E', 'electricity'],
    ['COMED WEB PMT', 'electricity'],
    ['PSEG', 'electricity'],
    // life insurers by brand
    ['NORTHWESTERN MUTUAL', 'life-insurance'],
    ['PRIMERICA LIFE', 'life-insurance'],
    ['NEW YORK LIFE', 'life-insurance'],
    // grocery / pharmacy / retail long tail added to the allowlists
    ['WALMART.COM', 'shopping'],
    ['WAL-MART #1234', 'shopping'],
    ['WINN-DIXIE #52', 'groceries'],
    ['DUANE READE 214', 'pharmacy'],
    ['RITE-AID 03421', 'pharmacy'],
  ];
  for (const [raw, categoryId] of cases) {
    it(`"${raw}" -> ${categoryId}, auto-filed (≥7000)`, () => {
      const m = normalizeMerchant(raw);
      expect(m.categoryId).toBe(categoryId);
      expect(m.confidenceBps).toBeGreaterThanOrEqual(7000);
      expect(m.aggregate).toBe(false);
    });
  }

  // Safety rails — the tier must NOT reach past its lane.
  it('aggregates (Zelle/checks/Venmo) are matched first and never touched by the vocab tier', () => {
    for (const raw of ['ZELLE PAYMENT TO MARCUS CHEN', 'CHECK #2041', 'VENMO PAYMENT 1029384756']) {
      const m = normalizeMerchant(raw);
      expect(m.aggregate).toBe(true);
      expect(m.categoryId).toBe('uncategorized');
      expect(m.confidenceBps).toBeLessThan(7000);
    }
  });

  it('genuinely ambiguous bare tokens stay in review (no over-eager guess)', () => {
    // bare RANGE (kitchen/gun/driving?), a mobile deposit, and an opaque brand must
    // NOT be force-filed — only disambiguated phrases (DRIVING RANGE) map.
    for (const raw of ['RANGE', 'MOBILEDEPOSIT', 'ACME WIDGETS LLC 7781']) {
      expect(normalizeMerchant(raw).categoryId).toBe('uncategorized');
    }
  });
});
