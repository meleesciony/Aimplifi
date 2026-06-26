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
  // Utility e-payments (electric/gas/water billers pay via "EPAY"/"BILLMATRIX")
  // must be caught BEFORE the generic transfer pattern below, which would
  // otherwise mislabel a real utility bill as a transfer and silently drop it
  // from spend. Requires BOTH a utility token AND a biller-payment token, so card
  // payments ("CHASE EPAY", "AMEX EPAYMENT") are untouched. (Surfaced by the
  // adversarial categorization eval; resolves STATUS #11.)
  { pattern: /\b(ENERGY|ELECTRIC|POWER|WATER|UTILIT)\b.*\b(EPAY(MENT)?|BILLMATRIX|BILL ?PAY)\b/i, canonical: 'Utility Bill', categoryId: 'utilities' },
  // Transfers — the SAME anchored pattern transfer detection uses (one source
  // of truth; substring matching here once erased real spending — critic F4)
  { pattern: /^ONLINE TRANSFER/i, canonical: 'Account Transfer', categoryId: 'transfer' },
  { pattern: TRANSFER_DESCRIPTOR, canonical: 'Card Payment', categoryId: 'transfer' },
  // Genuinely ambiguous — must go to review; aggregate ⇒ never offer rules
  { pattern: /^ZELLE PAYMENT/i, canonical: 'Zelle Payment', categoryId: 'uncategorized', confidenceBps: 4000, aggregate: true },
  { pattern: /^CHECK #/i, canonical: 'Check', categoryId: 'uncategorized', confidenceBps: 4000, aggregate: true },
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
  { pattern: /\b(DUNKIN|PEET'?S|DUTCH BROS|CARIBOU COFFEE|COFFEE|CAFE|CAFÉ|ESPRESSO|ROASTER)\b/i, categoryId: 'coffee' },
  { pattern: /\b(BURGER KING|WENDY|TACO BELL|CHIPOTLE|POPEYE|ARBY|SONIC DRIVE|FIVE GUYS|SHAKE SHACK|RAISING CANE|WHATABURGER|JACK IN THE BOX|DEL TACO|HARDEE|JIMMY JOHN|PANERA|JERSEY MIKE|FIREHOUSE SUB|KFC)\b/i, categoryId: 'fast-food' },
  { pattern: /\b(LIQUOR|WINE|SPIRITS|BREWING|BREWERY|TAPROOM|PUB|TAVERN|TOTAL WINE|ABC STORE|DISTILLER)\b/i, categoryId: 'alcohol' },
  { pattern: /\b(GROCER|GROCERY|SUPERMARKET|WHOLE FOODS|SAFEWAY|ALDI|WEGMAN|SPROUTS|H-?E-?B|FOOD LION|GIANT FOOD|STOP & SHOP|HARRIS TEETER|WINCO|FRESH MARKET|MEIJER|VONS|RALPHS|ALBERTSON|FOOD 4 LESS)\b/i, categoryId: 'groceries' },
  { pattern: /\b(RESTAURANT|GRILL|KITCHEN|BISTRO|DINER|EATERY|TAQUERIA|PIZZA|PIZZERIA|SUSHI|RAMEN|STEAKHOUSE|CANTINA|TRATTORIA|OYSTER|SEAFOOD|NOODLE|BAKERY|CREAMERY|ICE CREAM|JUICE|SMOOTHIE|BAR ?& ?GRILL|BBQ)\b/i, categoryId: 'dining' },
  // Auto & transport
  { pattern: /\b(EXXON|MOBIL|TEXACO|MARATHON|SUNOCO|CITGO|VALERO|CONOCO|PHILLIPS 66|ARCO|SPEEDWAY|WAWA|RACETRAC|CIRCLE K|FUEL|PETRO|GASOLINE)\b/i, categoryId: 'fuel' },
  { pattern: /\b(TAXI|YELLOW CAB)\b/i, categoryId: 'transport' },
  { pattern: /\b(METRO TRANSIT|TRANSIT|MTA|BART|MARTA|SEPTA|AMTRAK|GREYHOUND|MEGABUS)\b/i, categoryId: 'public-transit' },
  { pattern: /\b(PARKING|PARKMOBILE|PAYBYPHONE|SPOTHERO|TOLL|EZ ?PASS|E-?ZPASS|SUNPASS|FASTRAK)\b/i, categoryId: 'parking' },
  { pattern: /\b(AUTOZONE|O'?REILLY|PEP BOYS|ADVANCE AUTO|NAPA|JIFFY LUBE|VALVOLINE|FIRESTONE|MIDAS|MEINEKE|DISCOUNT TIRE|CAR WASH|AUTO REPAIR|COLLISION|BODY SHOP)\b/i, categoryId: 'auto-maintenance' },
  // Travel
  { pattern: /\b(UNITED AIR|AMERICAN AIR|SOUTHWEST AIR|JETBLUE|ALASKA AIR|SPIRIT AIR|FRONTIER AIR|AIRLINE|AIR ?LINES?|ALLEGIANT|HAWAIIAN AIR)\b/i, categoryId: 'air-travel' },
  { pattern: /\b(HILTON|HYATT|HOLIDAY INN|HAMPTON INN|SHERATON|WESTIN|RITZ|COURTYARD|RESIDENCE INN|MOTEL|HOTEL|RAMADA|BEST WESTERN|LA QUINTA|DOUBLETREE|EMBASSY SUITES|FAIRFIELD INN|RESORT)\b/i, categoryId: 'hotel' },
  { pattern: /\b(HERTZ|ENTERPRISE RENT|AVIS|BUDGET RENT|NATIONAL CAR|ALAMO|THRIFTY|DOLLAR RENT|SIXT|TURO|RENTAL CAR)\b/i, categoryId: 'rental-car' },
  { pattern: /\b(EXPEDIA|BOOKING\.COM|PRICELINE|TRAVELOCITY|KAYAK|ORBITZ|HOTWIRE|TRIPADVISOR|VACATION|CRUISE)\b/i, categoryId: 'travel' },
  // Health
  { pattern: /\b(RITE AID|PHARMACY|DRUG ?STORE)\b/i, categoryId: 'pharmacy' },
  { pattern: /\b(DENTAL|DENTIST|ORTHODONT|ENDODONT|PERIODONT)\b/i, categoryId: 'dental' },
  { pattern: /\b(VISION|OPTICAL|OPTOMETR|EYE CARE|LENSCRAFTER|WARBY PARKER|EYEGLASS|PEARLE)\b/i, categoryId: 'vision' },
  { pattern: /\b(GYM|FITNESS|YOGA|PILATES|CROSSFIT|PELOTON|EQUINOX|PLANET FIT|LIFE ?TIME|ORANGETHEORY|ANYTIME FITNESS|CYCLEBAR|SOULCYCLE)\b/i, categoryId: 'fitness' },
  { pattern: /\b(HOSPITAL|CLINIC|MEDICAL|PHYSICIAN|HEALTHCARE|URGENT CARE|LABCORP|QUEST DIAGNOST|RADIOLOGY|DERMATOLOG|PEDIATRIC|WELLNESS|CHIROPRACT|THERAPY)\b/i, categoryId: 'health' },
  // Personal & family
  { pattern: /\b(SALON|SPA|BARBER|HAIRCUT|NAIL|MASSAGE|SEPHORA|ULTA|GREAT CLIPS|SUPERCUTS|WAXING)\b/i, categoryId: 'personal-care' },
  { pattern: /\b(PETCO|PETSMART|CHEWY|VETERINAR|ANIMAL HOSPITAL|PET ?SUPPL|PET ?FOOD|BARKBOX)\b/i, categoryId: 'pets' },
  { pattern: /\b(DAYCARE|CHILD ?CARE|PRESCHOOL|KINDERCARE|BRIGHT HORIZONS|BABYSIT|LEARNING CENTER)\b/i, categoryId: 'childcare' },
  { pattern: /\b(TUITION|UNIVERSITY|COLLEGE|COURSERA|UDEMY|CHEGG|SCHOLAST)\b/i, categoryId: 'education' },
  // Shopping
  { pattern: /\b(BEST BUY|APPLE STORE|MICRO CENTER|NEWEGG|B&H PHOTO|GAMESTOP)\b/i, categoryId: 'electronics' },
  { pattern: /\b(NIKE|ADIDAS|LULULEMON|OLD NAVY|H&M|ZARA|UNIQLO|FOREVER 21|BANANA REPUBLIC|J\.?CREW|MADEWELL|NORDSTROM|MACY|DILLARD|TJ ?MAXX|MARSHALL|BURLINGTON|UNDER ARMOUR|FOOT LOCKER|CLOTHING|APPAREL)\b/i, categoryId: 'clothing' },
  { pattern: /\b(IKEA|WAYFAIR|ASHLEY FURN|POTTERY BARN|CRATE ?& ?BARREL|WEST ELM|HOME ?GOODS|FURNITURE|MATTRESS|BED BATH|CB2|ROOMS TO GO)\b/i, categoryId: 'furnishings' },
  { pattern: /\b(DICK'?S SPORTING|REI|ACADEMY SPORTS|BASS PRO|CABELA|HOBBY LOBBY|MICHAELS|JOANN|GUITAR CENTER|GOLF GALAXY|PGA (TOUR )?SUPERSTORE|SPORTING GOODS)\b/i, categoryId: 'hobbies' },
  { pattern: /\b(BARNES ?& ?NOBLE|BOOKSTORE|BOOKS-?A-?MILLION|AUDIBLE)\b/i, categoryId: 'books' },
  { pattern: /\b(SAM'?S CLUB|EBAY|ALIEXPRESS|TEMU|SHEIN|DOLLAR TREE|DOLLAR GENERAL|FAMILY DOLLAR|BIG LOTS|FIVE BELOW|KOHL|JCPENNEY)\b/i, categoryId: 'shopping' },
  // Home
  { pattern: /\b(ACE HARDWARE|MENARDS|HARBOR FREIGHT|HARDWARE|TRUE VALUE|SHERWIN[- ]?WILLIAMS)\b/i, categoryId: 'home-improvement' },
  { pattern: /\b(PLUMB|HVAC|ELECTRICIAN|PEST CONTROL|TERMINIX|ORKIN|CLEANING SERVICE|LANDSCAP|HANDYMAN|ROOFING|TRUGREEN)\b/i, categoryId: 'home-services' },
  { pattern: /\b(NURSERY|GARDEN CENTER|TRACTOR SUPPLY)\b/i, categoryId: 'lawn-garden' },
  // Bills & utilities
  { pattern: /\b(VERIZON|SPRINT|CRICKET WIRELESS|MINT MOBILE|BOOST MOBILE|US CELLULAR|STRAIGHT TALK|METRO ?PCS|VISIBLE WIRELESS)\b/i, categoryId: 'phone' },
  { pattern: /\b(SPECTRUM|COX COMM|CENTURYLINK|FRONTIER COMM|OPTIMUM|WINDSTREAM|FIOS|GOOGLE FIBER|HUGHESNET|STARLINK)\b/i, categoryId: 'internet' },
  { pattern: /\b(POWER|ELECTRIC|ENERGY|WATER (DEPT|UTILIT|BILL)|GAS COMPANY|UTILITY|MUNICIPAL|SEWER|WASTE MANAGEMENT|REPUBLIC SERVICES|DUKE ENERGY|GEORGIA POWER|DOMINION|NATIONAL GRID)\b/i, categoryId: 'utilities' },
  { pattern: /\b(PROGRESSIVE|STATE FARM|ALLSTATE|LIBERTY MUTUAL|NATIONWIDE|USAA|FARMERS INS|TRAVELERS INS|METLIFE|PRUDENTIAL|AFLAC|INSURANCE)\b/i, categoryId: 'insurance' },
  // Entertainment & software
  { pattern: /\b(HULU|DISNEY ?\+|DISNEY PLUS|HBO|PARAMOUNT ?\+|PEACOCK|APPLE TV|PRIME VIDEO|TWITCH|AMC|CINEMARK|REGAL CIN|CINEMA|THEATER|THEATRE|TICKETMASTER|STUBHUB|FANDANGO|XBOX|PLAYSTATION|NINTENDO|EPIC GAMES|LIVE NATION|TOPGOLF|GOLF|COUNTRY CLUB|BOWLING|ARCADE|MUSEUM|AQUARIUM|SIX FLAGS|UNIVERSAL STUDIO)\b/i, categoryId: 'entertainment' },
  { pattern: /\b(ADOBE|MICROSOFT|GITHUB|GOOGLE CLOUD|DROPBOX|NOTION|SLACK|ZOOM|OPENAI|ANTHROPIC|FIGMA|ATLASSIAN|GODADDY|NAMECHEAP|SQUARESPACE|MAILCHIMP|ICLOUD|GOOGLE WORKSPACE|GRAMMARLY|1PASSWORD|NORDVPN)\b/i, categoryId: 'software' },
  // Financial / giving
  { pattern: /\b(IRS|TAXES?|TURBOTAX|H&R BLOCK|TAX PREP|DEPT OF REVENUE|FRANCHISE TAX)\b/i, categoryId: 'taxes' },
  { pattern: /\b(STAPLES|OFFICE DEPOT|OFFICEMAX|FEDEX|UPS STORE|USPS|WEWORK)\b/i, categoryId: 'business' },
  { pattern: /\b(RED CROSS|GOFUNDME|UNICEF|SALVATION ARMY|GOODWILL|CHARITY|DONATION|UNITED WAY|ST JUDE|HABITAT FOR|NONPROFIT)\b/i, categoryId: 'charity' },
  { pattern: /\b(1-?800-?FLOWERS|TELEFLORA|HALLMARK|EDIBLE ARRANG)\b/i, categoryId: 'gifts' },
];

/** Aggregate canonical names that exist outside the ambiguous block too. */
const AGGREGATE_CANONICALS = new Set(['ATM Withdrawal', 'Account Transfer', 'Card Payment', 'Unknown Merchant']);

/**
 * Is this canonical merchant name an aggregate pseudo-merchant? Used by the
 * RULE READ PATH as defense in depth: even a rule row written before the
 * creation-time guard existed must never steer suggestions for an aggregate.
 */
export function isAggregateCanonical(canonical: string): boolean {
  if (AGGREGATE_CANONICALS.has(canonical)) return true;
  return KNOWN_MERCHANTS.some((m) => m.aggregate && m.canonical === canonical);
}

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
        aggregate: m.aggregate ?? AGGREGATE_CANONICALS.has(m.canonical),
      };
    }
  }
  const cleaned = cleanDescriptor(rawDescriptor);
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
  return {
    canonical: cleaned || 'Unknown Merchant',
    categoryId: 'uncategorized',
    confidenceBps: UNKNOWN_CONFIDENCE,
    known: false,
    aggregate: !cleaned,
  };
}
