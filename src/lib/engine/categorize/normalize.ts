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
  { pattern: /^LA FITNESS/i, canonical: 'LA Fitness', categoryId: 'fitness' },
  { pattern: /^(PF \*)?PLANET FIT/i, canonical: 'Planet Fitness', categoryId: 'fitness' },
  { pattern: /^HELLOFRESH/i, canonical: 'HelloFresh', categoryId: 'groceries' },
  { pattern: /^GEICO/i, canonical: 'Geico', categoryId: 'insurance' },
  { pattern: /^COMCAST|XFINITY/i, canonical: 'Xfinity', categoryId: 'utilities' },
  // Groceries / big box (patterns widened Phase 3a: real feeds vary the suffix —
  // 'KROGER QFC 5847', 'TARGET 00028031', 'TARGET.COM *', 'THE HOME DEPOT',
  // 'HOMEDEPOT.COM', 'SHELL SERVICE STATION' all previously missed their entry)
  { pattern: /^KROGER\b/i, canonical: 'Kroger', categoryId: 'groceries' },
  { pattern: /^PUBLIX/i, canonical: 'Publix', categoryId: 'groceries' },
  { pattern: /^SAFEWAY\b/i, canonical: 'Safeway', categoryId: 'groceries' },
  { pattern: /^TRADER JOE/i, canonical: "Trader Joe's", categoryId: 'groceries' },
  { pattern: /^WM SUPERCENTER/i, canonical: 'Walmart', categoryId: 'shopping' },
  { pattern: /^TARGET(\.COM)?\b/i, canonical: 'Target', categoryId: 'shopping' },
  // Dining chains
  { pattern: /^CHICK-FIL-A/i, canonical: 'Chick-fil-A', categoryId: 'dining' },
  { pattern: /^MCDONALD'?S/i, canonical: "McDonald's", categoryId: 'dining' },
  { pattern: /^CHIPOTLE\b/i, canonical: 'Chipotle', categoryId: 'fast-food' },
  { pattern: /^STARBUCKS/i, canonical: 'Starbucks', categoryId: 'dining' },
  { pattern: /^WAFFLE HOUSE/i, canonical: 'Waffle House', categoryId: 'dining' },
  // Fuel
  { pattern: /^SHELL (OIL|SERVICE)/i, canonical: 'Shell', categoryId: 'fuel' },
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
  { pattern: /^(THE\s+)?HOME\s*DEPOT(\.COM)?\b/i, canonical: 'Home Depot', categoryId: 'household' },
  { pattern: /^LOWES/i, canonical: "Lowe's", categoryId: 'household' },
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
  { pattern: /^ATM WITHDRAWAL/i, canonical: 'ATM Withdrawal', categoryId: 'cash' },
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
  { pattern: TRANSFER_DESCRIPTOR, canonical: 'Card Payment', categoryId: 'transfer' },
  // Genuinely ambiguous — must go to review; aggregate ⇒ never offer rules
  { pattern: /^ZELLE PAYMENT/i, canonical: 'Zelle Payment', categoryId: 'uncategorized', confidenceBps: 4000, aggregate: true },
  { pattern: /^VENMO\b/i, canonical: 'Venmo', categoryId: 'uncategorized', confidenceBps: 4000, aggregate: true },
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
  { pattern: /\b(ELECTRIC(ITY)?|POWER|ENERGY|CITY LIGHT|DUKE ENERGY|GEORGIA POWER)\b/i, categoryId: 'electricity' },
  { pattern: /\b(UTILITY|UTILITIES|MUNICIPAL|DOMINION|NATIONAL GRID)\b/i, categoryId: 'utilities' },
  { pattern: /\b(PROGRESSIVE|STATE FARM|ALLSTATE|LIBERTY MUTUAL|NATIONWIDE|USAA|FARMERS INS|TRAVELERS INS|METLIFE|PRUDENTIAL|AFLAC|INSURANCE)\b/i, categoryId: 'insurance' },
  // Entertainment & software
  { pattern: /\b(HULU|DISNEY ?\+|DISNEY PLUS|HBO|PARAMOUNT ?\+|PEACOCK|APPLE TV|PRIME VIDEO|TWITCH|AMC|CINEMARK|REGAL CIN|CINEMA|THEATER|THEATRE|TICKETMASTER|STUBHUB|FANDANGO|XBOX|PLAYSTATION|NINTENDO|EPIC GAMES|LIVE NATION|TOPGOLF|GOLF|COUNTRY CLUB|BOWLING|ARCADE|MUSEUM|AQUARIUM|SIX FLAGS|UNIVERSAL STUDIO)\b/i, categoryId: 'entertainment' },
  { pattern: /\b(ADOBE|MICROSOFT|GITHUB|GOOGLE CLOUD|DROPBOX|NOTION|SLACK|ZOOM|OPENAI|ANTHROPIC|FIGMA|ATLASSIAN|GODADDY|NAMECHEAP|SQUARESPACE|MAILCHIMP|ICLOUD|GOOGLE WORKSPACE|GRAMMARLY|1PASSWORD|NORDVPN)\b/i, categoryId: 'software' },
  // Income & bank fees — no KNOWN_MERCHANT or other generic rule covered these, so
  // strong, unambiguous signals (payroll deposits, interest earned, overdraft/late
  // fees) were falling through to manual review. Descriptor-only like every rule
  // here; the income-vs-expense SIGN is handled downstream by monthlyFlows.
  { pattern: /\b(PAYROLL|DIRECT DEP(OSIT)?|GUSTO|ADP|PAYCHEX|TRINET|RIPPLING|INTEREST EARNED|DIVIDEND|PENSION|SOCIAL SECURITY|SSA TREAS|UNEMPLOYMENT)\b/i, categoryId: 'income' },
  { pattern: /\b(OVERDRAFT|NSF FEE|INSUFFICIENT FUNDS|RETURNED ITEM FEE|LATE FEE|SERVICE CHARGE|MONTHLY (MAINTENANCE|SERVICE) FEE|MAINTENANCE FEE|ANNUAL FEE|FOREIGN TRANSACTION FEE|ATM FEE|WIRE FEE|FINANCE CHARGE|INTEREST CHARGE)\b/i, categoryId: 'fees' },
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

/** Trailing-location state codes (feed suffixes like "SEATTLE WA"). */
const US_STATE_RE =
  /\s+(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|WA|WV|WI|WY|DC)$/i;

/** Generic cleanup for descriptors we have no pattern for. */
export function cleanDescriptor(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^(SQ \*|TST\*\s*|PAYPAL \*|PP\*|PY \*|DD \*|POS \d+ )/i, '');
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
  return {
    canonical: cleaned || 'Unknown Merchant',
    categoryId: 'uncategorized',
    confidenceBps: UNKNOWN_CONFIDENCE,
    known: false,
    aggregate: !cleaned,
  };
}
