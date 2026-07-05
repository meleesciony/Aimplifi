// categorize-benchmark-corpus.ts
//
// INDEPENDENT ground-truth corpus for the transaction categorizer benchmark.
// These descriptors were written from knowledge of how real US bank/card feeds
// (Plaid, OFX, CSV exports) actually render merchants -- processor prefixes,
// store numbers, city/state suffixes, phone numbers, card masks, bank-side
// boilerplate -- NOT from the engine's own keyword/merchant tables. Labels are
// what a careful human would assign from the descriptor alone; `null` means a
// human genuinely could not categorize it (P2P, bare checks, cryptic LLCs).
// `amountCents` is included only where sign matters (income/refund cases are
// positive); the harness defaults everything else to a negative spend.
// Pure data. No imports.

// Labels follow the #163 leaf-precision conventions (Starbucks=coffee,
// CVS/Walgreens=pharmacy, payroll=paycheck, interest=interest-income).
export const NOVEL_CASES: { raw: string; label: string | null; amountCents?: number }[] = [
  // ---------------------------------------------------------------- fast food
  { raw: "WENDYS #6412 COLUMBUS OH", label: "fast-food" },
  { raw: "PURCHASE AUTHORIZED ON 06/12 TACO BELL 029341 PHOENIX AZ CARD 1234", label: "fast-food" },
  { raw: "SUBWAY 48213 KNOXVILLE TN", label: "fast-food" },
  { raw: "DOMINOS 7896 866-310-0106 TX", label: "fast-food" },
  { raw: "PIZZA HUT 034812 800-948-8488 KY", label: "fast-food" },
  { raw: "PAPA JOHNS #1123 CHARLOTTE NC", label: "fast-food" },
  { raw: "DAIRY QUEEN #14201 MINNEAPOLIS MN", label: "fast-food" },
  { raw: "POS DEBIT CULVERS OF MADISON WI", label: "fast-food" },
  { raw: "ZAXBYS #482 ATHENS GA", label: "fast-food" },
  { raw: "BOJANGLES 771 RALEIGH NC", label: "fast-food" },
  { raw: "IN-N-OUT BURGER #281 DALLAS TX", label: "fast-food" },
  { raw: "WHATABURGER 962 SAN ANTONIO TX", label: "fast-food" },
  { raw: "MCDONALD'S F32812 TAMPA FL", label: "fast-food" },
  { raw: "CHECKCARD 0612 CHIPOTLE 2381 DENVER CO", label: "fast-food" },
  { raw: "PANERA BREAD #204581 SAINT LOUIS MO", label: "fast-food" },

  // ------------------------------------------------------------------- coffee
  { raw: "DUNKIN #348521 Q35 BOSTON MA", label: "coffee" },
  { raw: "PURCHASE AUTHORIZED ON 05/28 DUNKIN #351102 PROVIDENCE RI", label: "coffee" },
  { raw: "DUTCH BROS OR-142 GRANTS PASS OR", label: "coffee" },
  { raw: "PEET'S COFFEE #08321 BERKELEY CA", label: "coffee" },
  { raw: "CARIBOU COFFEE CO #302 MINNEAPOLIS MN", label: "coffee" },
  { raw: "TIM HORTONS #911422 BUFFALO NY", label: "coffee" },
  { raw: "SCOOTER'S COFFEE #512 OMAHA NE", label: "coffee" },
  { raw: "SQ *BLUE HERON COFFEE ROAST Portland OR", label: "coffee" },
  { raw: "STARBUCKS STORE 08321 SEATTLE WA", label: "coffee" },
  { raw: "CHECKCARD 0601 STARBUCKS 800-782-7282 WA", label: "coffee" },

  // ------------------------------------------------------- sit-down / dining
  { raw: "TST* THE RUSTED FORK - NASH Nashville TN", label: "dining" },
  { raw: "OLIVE GARDEN 0021483 ORLANDO FL", label: "dining" },
  { raw: "TEXAS ROADHOUSE #2481 LUBBOCK TX", label: "dining" },
  { raw: "APPLEBEES 88123 GRAND RAPIDS MI", label: "dining" },
  { raw: "OUTBACK 3412 TAMPA FL", label: "dining" },
  { raw: "CHILI'S GRILL 448 EL PASO TX", label: "dining" },
  { raw: "WAFFLE HOUSE 1802 ATLANTA GA", label: "dining" },
  { raw: "TST* LUNA ROSA TRATTORIA BROOKLYN NY", label: "dining" },
  { raw: "PURCHASE AUTHORIZED ON 06/07 RED LOBSTER 0384 LANSING MI", label: "dining" },

  // ------------------------------------------------------------ food delivery
  { raw: "DD *DOORDASH WINGSTOP 855-431-0459 CA", label: "food-delivery" },
  { raw: "DD DOORDASH DASHPASS 855-973-1040 CA", label: "food-delivery" },
  { raw: "UBER EATS 8005928996 CA", label: "food-delivery" },
  { raw: "GRUBHUB*SEAMLESS NEW YORK NY", label: "food-delivery" },
  { raw: "POSTMATES TIP 800-882-6106 CA", label: "food-delivery" },

  // ------------------------------------------------------------------ alcohol
  { raw: "TOTAL WINE AND MORE #1802 CHERRY HILL NJ", label: "alcohol" },
  { raw: "ABC FINE WINE & SPIRITS 112 ORLANDO FL", label: "alcohol" },
  { raw: "POS DEBIT BEVMO #218 SACRAMENTO CA", label: "alcohol" },

  // ---------------------------------------------------------------- groceries
  { raw: "WHOLE FOODS MKT #10281 AUSTIN TX", label: "groceries" },
  { raw: "ALDI 68012 CINCINNATI OH", label: "groceries" },
  { raw: "H-E-B #612 SAN ANTONIO TX", label: "groceries" },
  { raw: "WEGMANS #84 ROCHESTER NY", label: "groceries" },
  { raw: "WINN-DIXIE #1482 JACKSONVILLE FL", label: "groceries" },
  { raw: "FOOD LION #2611 GREENSBORO NC", label: "groceries" },
  { raw: "SPROUTS FARMERS MKT #412 PHOENIX AZ", label: "groceries" },
  { raw: "GIANT #6412 HARRISBURG PA", label: "groceries" },
  { raw: "RALPHS #0281 LOS ANGELES CA", label: "groceries" },
  { raw: "HANNAFORD #8121 PORTLAND ME", label: "groceries" },
  { raw: "INGLES MARKETS #442 ASHEVILLE NC", label: "groceries" },
  { raw: "LIDL #3308 RICHMOND VA", label: "groceries" },
  { raw: "PURCHASE AUTHORIZED ON 06/03 KROGER #948 ATLANTA GA CARD 5678", label: "groceries" },
  { raw: "POS DEBIT PUBLIX SUPER MAR 1482 TAMPA FL", label: "groceries" },
  { raw: "COSTCO WHSE #0482 TUKWILA WA", label: "groceries" },
  { raw: "COSTCO GAS #0482 TUKWILA WA", label: "fuel" },

  // ------------------------------------------------------- big box and retail
  { raw: "SAMS CLUB #6412 FAYETTEVILLE AR", label: "groceries" }, // warehouse clubs follow the Costco precedent (#163),
  { raw: "BJS WHOLESALE #0322 FRAMINGHAM MA", label: "groceries" }, // warehouse clubs follow the Costco precedent (#163)
  { raw: "WM SUPERC #2811 BENTONVILLE AR", label: "shopping" },
  { raw: "DEBIT CARD PURCHASE - WAL-MART #3218 GARDEN CITY KS", label: "shopping" },
  { raw: "TARGET 00028415 CHICAGO IL", label: "shopping" },
  { raw: "ROSS STORES #442 MESA AZ", label: "clothing" },
  { raw: "TJ MAXX #308 NASHUA NH", label: "clothing" },
  { raw: "MARSHALLS #1121 QUEENS NY", label: "clothing" },
  { raw: "BURLINGTON STORES 482 PATERSON NJ", label: "clothing" },
  { raw: "KOHL'S #0442 SHEBOYGAN WI", label: "clothing" },
  { raw: "NORDSTROM RACK #128 COSTA MESA CA", label: "clothing" },
  { raw: "DOLLAR GENERAL #14812 BIRMINGHAM AL", label: "general-merchandise" },
  { raw: "POS DEBIT DOLLAR TREE #3182 MEMPHIS TN", label: "general-merchandise" },
  { raw: "FIVE BELOW #1281 PHILADELPHIA PA", label: "general-merchandise" }, // dollar/discount stores = general merchandise (#163)

  // ---------------------------------------------------------------------- gas
  { raw: "EXXONMOBIL 97481221 HOUSTON TX", label: "fuel" },
  { raw: "BP#8481221CIRCLE B FOOD MART TULSA OK", label: "fuel" },
  { raw: "CIRCLE K #06412 TEMPE AZ", label: "fuel" },
  { raw: "WAWA 8123 00081234 PHILADELPHIA PA", label: "fuel" },
  { raw: "SHEETZ 0442 ALTOONA PA", label: "fuel" },
  { raw: "RACETRAC 481 00004812 MARIETTA GA", label: "fuel" },
  { raw: "CASEYS GEN STORE 2481 DES MOINES IA", label: "fuel" },
  { raw: "PILOT 00281 KNOXVILLE TN", label: "fuel" },
  { raw: "LOVES TRAVEL 00412 AMARILLO TX", label: "fuel" },
  { raw: "MURPHY7481ATWALMART EL DORADO AR", label: "fuel" },
  { raw: "7-ELEVEN 32811 FUEL DALLAS TX", label: "fuel" },
  { raw: "BUC-EE'S #35 NEW BRAUNFELS TX", label: "fuel" },
  { raw: "CHECKCARD 0618 SHELL OIL 57544128102 SPOKANE WA", label: "fuel" },
  { raw: "PURCHASE AUTHORIZED ON 06/18 QT 794 OKLAHOMA CITY OK", label: "fuel" },

  // ------------------------------------------------------ pharmacy / drugstore
  { raw: "RITE AID STORE - 04821 SCRANTON PA", label: "pharmacy" },
  { raw: "RITE AID #03118 ALBANY NY", label: "pharmacy" },
  { raw: "WALGREENS #6412 CHICAGO IL", label: "pharmacy" },
  { raw: "PURCHASE AUTHORIZED ON 06/09 WALGREENS STORE 3218 W AD MIAMI FL", label: "pharmacy" },
  { raw: "CVS/PHARMACY #08321 DURHAM NC", label: "pharmacy" },
  { raw: "CVS/PHARM 04821--242 MAIN ST BOSTON MA", label: "pharmacy" },

  // -------------------------------------------- streaming and subscriptions
  { raw: "HULU 848481221211-U 877-8244858 CA", label: "entertainment" },
  { raw: "DISNEY PLUS 888-9057888 CA", label: "entertainment" },
  { raw: "MAX.COM 888-882-6996 NY", label: "entertainment" },
  { raw: "PARAMOUNT+ 888-274-5343 NY", label: "entertainment" },
  { raw: "PEACOCK 8XW PREMIUM NEW YORK NY", label: "entertainment" },
  { raw: "YOUTUBE TV G.CO/HELPPAY# CA", label: "entertainment" },
  { raw: "RECURRING PAYMENT AUTHORIZED ON 06/04 NETFLIX.COM 866-579-7172 CA", label: "entertainment" },
  { raw: "CRUNCHYROLL *MEMBERSHIP SAN FRANCISCO CA", label: "entertainment" },
  { raw: "SPOTIFY USA 877-778-1161 NY", label: "entertainment" }, // convention: streaming = entertainment (#163)
  { raw: "AUDIBLE*MK2AB12T3 AMZN.COM/BILL NJ", label: "books" },
  { raw: "KINDLE UNLTD*2Y4EX8DD2 888-802-3080 WA", label: "books" },
  { raw: "APPLE.COM/BILL 866-712-7753 CA", label: "software" },
  { raw: "RECURRING PAYMENT AUTHORIZED ON 06/02 APPLE.COM/BILL 866-712-7753 CA", label: "software" },
  { raw: "ITUNES.COM/BILL 866-712-7753 CA", label: "software" },
  { raw: "AMAZON PRIME*RT4EE2113 AMZN.COM/BILL WA", label: "subscriptions" },
  { raw: "MICROSOFT*XBOX GAME PASS MSBILL.INFO WA", label: "games" },
  { raw: "PLAYSTATION NETWORK 877-971-7669 CA", label: "games" },
  { raw: "NINTENDO CD9382101 800-2553700 WA", label: "games" },
  { raw: "RING YEARLY PLAN 888-981-8993 CA", label: "subscriptions" },
  { raw: "DROPBOX*Z2G8Q1XW2K12 DROPBOX.COM CA", label: "software" },
  { raw: "OPENAI *CHATGPT SUBSCR OPENAI.COM CA", label: "software" },
  { raw: "CLAUDE.AI SUBSCRIPTION ANTHROPIC SAN FRANCISCO CA", label: "software" },
  { raw: "PADDLE.NET* OBSIDIANMD 800-6501885 NY", label: "software" },
  { raw: "RECURRING PAYMENT AUTHORIZED ON 06/06 SXM*SIRIUSXM.COM/ACCT 888-635-5144 NY", label: "entertainment" }, // streaming = entertainment (#163)

  // ---------------------------------------------------------- telecom / phone
  { raw: "AT&T *PAYMENT 800-288-2020 TX", label: "phone" },
  { raw: "VERIZON WRLS 08421-01 800-922-0204 NJ", label: "phone" },
  { raw: "RECURRING PAYMENT AUTHORIZED ON 05/30 VZWRLSS*APOCC VISB 800-922-0204 FL", label: "phone" },
  { raw: "SPECTRUM MOBILE 855-707-7328 MO", label: "phone" },
  { raw: "GOOGLE FI G.CO/HELPPAY# CA", label: "phone" },
  { raw: "TMOBILE*AUTO PAY 800-937-8997 WA", label: "phone" },
  { raw: "COMCAST/XFINITY 800-266-2278 PA", label: "internet" },
  { raw: "WEB PMT SPECTRUM 855-707-7328 MO", label: "internet" },

  // ----------------------------------------------------------------- airlines
  { raw: "UNITED 0162341234567 800-932-2732 TX", label: "air-travel" },
  { raw: "AMERICAN AIR0012345678901 FORT WORTH TX", label: "air-travel" },
  { raw: "SOUTHWES 5262341234567 800-435-9792 TX", label: "air-travel" },
  { raw: "ALASKA AIR 0272341234567 SEATTLE WA", label: "air-travel" },
  { raw: "SPIRIT AIRL 4872341234567 MIRAMAR FL", label: "air-travel" },
  { raw: "FRONTIER 4222341234567 DENVER CO", label: "air-travel" },
  { raw: "ALLEGIANT AIR 892341234 702-505-8888 NV", label: "air-travel" },

  // ------------------------------------------------------------------- hotels
  { raw: "HILTON GARDEN INN NASHVILLE TN", label: "hotel" },
  { raw: "HYATT PLACE DENVER TECH CTR CO", label: "hotel" },
  { raw: "IHG*HOLIDAY INN EXP 877-8345929 GA", label: "hotel" },
  { raw: "SUPER 8 BY WYNDHAM SAN MARCOS TX", label: "hotel" },
  { raw: "CHOICE HOTELS COMFORT INN 800-4246423 MD", label: "hotel" },
  { raw: "COURTYARD BY MARRIOTT PHX AIRPORT AZ", label: "hotel" },

  // --------------------------------------------------- rideshare and transit
  { raw: "UBER *TRIP HELP.UBER.COM CA", label: "transport" },
  { raw: "CHECKCARD 0620 UBER *TRIP HELP.UBER.COM CA", label: "transport" },
  { raw: "LYFT *RIDE THU 2PM SAN FRANCISCO CA", label: "transport" },
  { raw: "LYFT *2 RIDES 05-14 855-865-9553 CA", label: "transport" },
  { raw: "CITY OF AUSTIN PARKING AUSTIN TX", label: "parking" },
  { raw: "PHILADELPHIA PARKING AUTH PHILADELPHIA PA", label: "parking" },
  { raw: "E-ZPASS REBILL 800-333-8655 NJ", label: "parking" }, // taxonomy leaf is "Parking & Tolls" (#163)
  { raw: "MTA*NYCT PAYGO NEW YORK NY", label: "public-transit" },
  { raw: "CHICAGO TRANSIT VENTRA 888-9368368 IL", label: "public-transit" },

  // ---------------------------------------------------------------- utilities
  { raw: "CITY OF RALEIGH WATER UTIL BILL PAY NC", label: "water" },
  { raw: "WEB PMT GREENVILLE WATER 800-541-9508 SC", label: "water" },
  { raw: "DUKE ENERGY BILL PAY 800-777-9898 NC", label: "electricity" },
  { raw: "PEDERNALES ELEC COOP UTIL ACH", label: "electricity" },
  { raw: "WASTE MGMT WM EZPAY 866-964-2729 TX", label: "trash" },
  { raw: "REPUBLIC SERVICES TRASH 8802 AZ", label: "trash" },
  { raw: "PIEDMONT NATURAL GAS 800-752-7504 NC", label: "natural-gas" },
  { raw: "WEB PMT COLUMBIA GAS OF OHIO", label: "natural-gas" },
  { raw: "CITY OF MESA UTILITIES WEB PMT AZ", label: "utilities" },

  // ---------------------------------------------------------------- insurance
  { raw: "PROGRESSIVE *INSURANCE 800-776-4737 OH", label: "auto-insurance" },
  { raw: "RECURRING PAYMENT AUTHORIZED ON 06/01 PROGRESSIVE INS 800-7764737 OH", label: "auto-insurance" },
  { raw: "STATE FARM INSURANCE 800-956-6310 IL", label: "insurance" },
  { raw: "ROOT INSURANCE COLUMBUS OH", label: "auto-insurance" },
  { raw: "LEMONADE INSURANCE NEW YORK NY", label: "insurance" },
  { raw: "BCBS OF TX PREMIUM ACH PPD", label: "health-insurance" },
  { raw: "GLOBE LIFE INS PREM 800-8011397", label: "life-insurance" },

  // ------------------------------------------------------------------ fitness
  { raw: "CRUNCH FITNESS #0482 TAMPA FL", label: "fitness" },
  { raw: "YMCA OF GREATER HOUSTON TX", label: "fitness" },
  { raw: "CLASSPASS* MONTHLY 646-9203972 NY", label: "fitness" },
  { raw: "24 HOUR FITNESS USA #482 SAN RAMON CA", label: "fitness" },
  { raw: "RECURRING PAYMENT AUTHORIZED ON 06/15 PLANET FIT CLUB FEES 844-880-7180 NH", label: "fitness" },

  // ------------------------------------------------------------ personal care
  { raw: "GREAT CLIPS AT WESTGATE 0482 GLENDALE AZ", label: "personal-care" },
  { raw: "SQ *FADES BY MARCO Charlotte NC", label: "personal-care" },
  { raw: "ULTA #482 OVERLAND PARK KS", label: "personal-care" },
  { raw: "DEBIT CARD PURCHASE - SALLY BEAUTY #2481 DENTON TX", label: "personal-care" },

  // --------------------------------------------------------------------- pets
  { raw: "BANFIELD PET HOSP #482 PORTLAND OR", label: "pets" },
  { raw: "VCA ANIMAL HOSP 0412 LOS ANGELES CA", label: "pets" },
  { raw: "POS DEBIT PETCO 1482 63148121 SAN DIEGO CA", label: "pets" },
  { raw: "CHEWY.COM 800-672-4399 FL", label: "pets" },

  // ----------------------------------------------------------- kids/childcare
  { raw: "KINDERCARE 001482 PORTLAND OR", label: "childcare" },
  { raw: "BRIGHT HORIZONS CHILDCARE 617-673-8000 MA", label: "childcare" },
  { raw: "CARTER'S #0812 ATLANTA GA", label: "kids" },
  { raw: "THE CHILDREN'S PLACE #1482 SECAUCUS NJ", label: "kids" },

  // --------------------------------------------------------- home improvement
  { raw: "MENARDS EAU CLAIRE WI", label: "home-improvement" },
  { raw: "ACE HDWE #08321 BOISE ID", label: "home-improvement" },
  { raw: "TRACTOR SUPPLY C #2481 WACO TX", label: "lawn-garden" }, // farm/ranch/garden retailer (#163)
  { raw: "THE HOME DEPOT #0482 ATLANTA GA", label: "home-improvement" },
  { raw: "LOWES #01482* CHARLOTTE NC", label: "home-improvement" },

  // -------------------------------------------------------------- online retail
  { raw: "ETSY.COM* MAPLEANDMOSS BROOKLYN NY", label: "shopping" },
  { raw: "EBAY O*12-34567-89012 SAN JOSE CA", label: "shopping" },
  { raw: "SHEIN.COM LOS ANGELES CA", label: "clothing" },
  { raw: "TEMU.COM BOSTON MA", label: "shopping" },
  { raw: "WAYFAIR*WAYFAIR 866-263-8325 MA", label: "furnishings" },
  { raw: "STOCKX LLC DETROIT MI", label: "clothing" },
  { raw: "POSHMARK INC 650-2624771 CA", label: "clothing" },
  { raw: "AMZN MKTP US*RT4EE21A3 AMZN.COM/BILLWA", label: "shopping" },
  { raw: "AMAZON.COM*M12AB34CD SEATTLE WA", label: "shopping" },

  // -------------------------------------------------------------- electronics
  { raw: "BEST BUY #00482 RICHFIELD MN", label: "electronics" },
  { raw: "BESTBUYCOM806481221211 888BESTBUY MN", label: "electronics" },
  { raw: "APPLE STORE R122 PALO ALTO CA", label: "electronics" },
  { raw: "STEAMGAMES.COM 4259522985 WA", label: "games" },
  { raw: "GAMESTOP #4821 GRAPEVINE TX", label: "games" },
  { raw: "MICRO CENTER #141 CAMBRIDGE MA", label: "electronics" },

  // ------------------------------------------------------------------- health
  { raw: "ONE MEDICAL 888-663-6331 CA", label: "health" },
  { raw: "QUEST DIAGNOSTICS 866-697-8378 NJ", label: "health" },
  { raw: "LABCORP 800-845-6167 NC", label: "health" },
  { raw: "ASPEN DENTAL 866-273-8606 NY", label: "dental" },
  { raw: "MYEYEDR 0482 VIENNA VA", label: "vision" },
  { raw: "BETTERHELP 888-688-9296 CA", label: "mental-health" },

  // ---------------------------------------------------------------- education
  { raw: "COURSERA.ORG MOUNTAIN VIEW CA", label: "education" },
  { raw: "CHEGG ORDER 855-581-9873 CA", label: "education" },
  { raw: "WEB PMT UNIV OF PHOENIX TUITION", label: "education" },

  // ------------------------------------------------------------------ charity
  { raw: "TITHE.LY* GRACE COMMUNITY CH 855-551-7997 TN", label: "charity" },
  { raw: "FIRST BAPTIST CHURCH OF TULSA GIVING OK", label: "charity" },
  { raw: "ST JUDE CHILDRENS RSCH 800-822-6344 TN", label: "charity" },
  { raw: "AMERICAN RED CROSS DONATE 800-435-7669 DC", label: "charity" },

  // ------------------------------------------- P2P (genuinely uncategorizable)
  { raw: "VENMO PAYMENT 1028481221 NY", label: null },
  { raw: "VENMO *JESSICA SMITH 855-812-4430 NY", label: null },
  { raw: "CASH APP*JORDAN B 8774174551 CA", label: null },
  { raw: "ZELLE PAYMENT TO MICHAEL R 08321221", label: null },
  { raw: "ZELLE FROM SARAH K CONF# T2X84PLQ1", label: null, amountCents: 12000 },
  { raw: "PAYPAL *TRANSFER 402-935-7733", label: null },
  { raw: "PP*4829CODE PAYPAL TRANSFER", label: null },
  { raw: "PAYPAL *JOHNSMITH 402-935-7733 CA", label: null },
  { raw: "APPLE CASH SENT 1INFINITELOOP CA", label: null },
  { raw: "CASH APP*CASH OUT 8774174551 CA", label: null, amountCents: 5000 },
  { raw: "WU *WESTERN UNION 800-325-6000 CO", label: null },
  { raw: "MONEYGRAM 0482 800-9269400 TX", label: null },
  { raw: "SQ *EVENT 06/21", label: null },

  // ------------------------------------- transfers / credit card payments
  { raw: "ONLINE TRANSFER TO SAV XXXXXX1234 06/15", label: "transfer" },
  { raw: "ONLINE TRANSFER REF #IB0X8PLQ2R FROM CHECKING ****1234", label: "transfer" },
  { raw: "CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224", label: "transfer" },
  { raw: "CAPITAL ONE CRCARDPMT 0482 WEB", label: "transfer" },
  { raw: "PAYMENT THANK YOU - WEB", label: "transfer" },
  { raw: "DISCOVER E-PAYMENT 8003472683 DE", label: "transfer" },
  { raw: "BARCLAYCARD US CREDITCARD PYMT WEB", label: "transfer" },

  // ------------------------------------------------------------------- income
  { raw: "ACH CREDIT ACME CORP PAYROLL 062026", label: "paycheck", amountCents: 250000 },
  { raw: "DIRECT DEP ACME STAFFING LLC PPD ID: 1234567890", label: "paycheck", amountCents: 184522 },
  { raw: "DFAS-CLEVELAND FED SALARY XXXXXX1234", label: "paycheck", amountCents: 212000 }, // military salary = paycheck (#163)
  { raw: "GUSTO PAY 128481 DES:PAYROLL", label: "paycheck", amountCents: 198750 },
  { raw: "ADP PAYROLL RUN - WEEKLY TX", label: "paycheck", amountCents: 96200 },
  { raw: "INTEREST PAYMENT .04% APY", label: "interest-income", amountCents: 312 },
  { raw: "NC DES UNEMPLOYMENT INS BENEFIT", label: "govt-benefits", amountCents: 35000 },
  { raw: "STATE OF CA EDD UI DEPOSIT PPD", label: "govt-benefits", amountCents: 45000 },
  { raw: "SSA TREAS 310 XXSOC SEC PPD", label: "govt-benefits", amountCents: 187600 },
  { raw: "IRS TREAS 310 TAX REF PPD", label: "tax-refund", amountCents: 143700 },
  { raw: "FRANCHISE TAX BD CASTTAXRFD", label: "tax-refund", amountCents: 21500 },
  { raw: "STRIPE TRANSFER ST-X8PLQ2R1", label: "side-income", amountCents: 42250 },
  { raw: "UBER DRIVER PARTNER PAYMENT ACH", label: "side-income", amountCents: 31875 },
  { raw: "ACH CREDIT BUILDIUM RENT PAYOUT", label: "rental-income", amountCents: 165000 },
  { raw: "ACH CREDIT CONCUR EXPENSE REIMB", label: "reimbursement", amountCents: 28450 },

  // ------------------------------------------------------------------ refunds
  { raw: "AMZN MKTP US REFUND ORDER 112-482112", label: "shopping", amountCents: 3499 }, // returns offset the original category (Mint/Simplifi convention, #163)
  { raw: "TARGET 00028415 REFUND CHICAGO IL", label: "shopping", amountCents: 2118 }, // returns offset the original category (#163)
  { raw: "REFUND: DELTA AIR 0062341234567", label: "air-travel", amountCents: 24800 }, // returns offset the original category (#163)

  // --------------------------------------------------------------- fees / ATM
  { raw: "OVERDRAFT FEE FOR A TRANSACTION POSTED ON 06/11", label: "fees" },
  { raw: "MONTHLY SERVICE FEE", label: "fees" },
  { raw: "NON-CHASE ATM FEE-WITH", label: "fees" },
  { raw: "FOREIGN TRANSACTION FEE 06/02", label: "fees" },
  { raw: "ATM WITHDRAWAL 06/14 XXXXXX1234 100 MAIN ST", label: "cash" },
  { raw: "ALLPOINT ATM CASH WITHDRAWAL 0482", label: "cash" },
  { raw: "NON-BANK ATM WITHDRAWAL 000482 7-ELEVEN DALLAS TX", label: "cash" },

  // ------------------------------------------------------------------- checks
  { raw: "CHECK #1042", label: null },
  { raw: "CHECK 2210", label: null },
  { raw: "CHECK PAID #883", label: null },

  // -------------------------------------------------------- housing and rent
  { raw: "RENTPAYMENT 866-289-5977 CA", label: "rent" },
  { raw: "WEB PMT GREYSTAR PROP MGMT RENT", label: "rent" },
  { raw: "OAKWOOD MEADOWS HOA DUES ACH", label: "hoa" },
  { raw: "COUNTY OF TRAVIS PROP TAX WEB PMT", label: "property-tax" },
  { raw: "PUBLIC STORAGE 28482 800-5551212 CA", label: "storage" },

  // -------------------------------------------------------------- car rental
  { raw: "ENTERPRISE RENT-A-CAR 0482 ORLANDO FL", label: "rental-car" },
  { raw: "HERTZ CAR RENTAL 482231 MCO ORLANDO FL", label: "rental-car" },

  // ------------------------------------------------------- travel / lodging alt
  { raw: "AIRBNB * HM2X8PLQ1 SAN FRANCISCO CA", label: "travel" },
  { raw: "VRBO HA-PMTS 877-2023898 TX", label: "travel" },

  // ---------------------------------------------------- entertainment / events
  { raw: "TICKETMASTER EVENT 800-653-8000 CA", label: "events" },
  { raw: "AMC ONLINE 8887262639 KS", label: "entertainment" },
  { raw: "TOPGOLF #23 THE COLONY TX", label: "entertainment" },

  // ------------------------------------------------- hobbies / books / office
  { raw: "HOBBY LOBBY #482 OKLAHOMA CITY OK", label: "hobbies" },
  { raw: "MICHAELS STORES #9482 IRVING TX", label: "hobbies" },
  { raw: "BARNES & NOBLE #2481 NEW YORK NY", label: "books" },
  { raw: "STAPLES 00104821 FRAMINGHAM MA", label: "office-supplies" },
  { raw: "OFFICE DEPOT #482 DELRAY BEACH FL", label: "office-supplies" },
  { raw: "IKEA CONSHOHOCKEN PA", label: "furnishings" },
  { raw: "AT HOME STORE #482 PLANO TX", label: "furnishings" },
  { raw: "THE CONTAINER STORE #482 DALLAS TX", label: "household" },
  { raw: "CHECKCARD 0609 HOMEGOODS #482 NAPERVILLE IL", label: "furnishings" }, // home-decor retail = Home Furnishings leaf (#163)

  // ------------------------------------------------------- taxes / financial
  { raw: "H&R BLOCK TAX PREP 0482 KANSAS CITY MO", label: "taxes" },
  { raw: "TURBOTAX *INTUIT 800-4468848 CA", label: "taxes" },
  { raw: "IRS USATAXPYMT PPD ID: 3387702000", label: "taxes" },
  { raw: "EXPERIAN *CREDITREPORT 479-3436237 CA", label: "financial" },
  { raw: "LEGALZOOM.COM 800-7730888 CA", label: "legal" },

  // --------------------------------------------------------------- investing
  { raw: "VANGUARD BUYINVESTMENT WEB", label: "investment" },
  { raw: "FID BKG SVC LLC MONEYLINE PPD", label: "investment" },
  { raw: "COINBASE.COM 8883308895 CA", label: "investment" },
  { raw: "ROBINHOOD FUNDS 650-9405700 CA", label: "investment" },

  // -------------------------------------------------------------------- loans
  { raw: "NELNET LOAN PMT WEB", label: "loan-payment" },
  { raw: "MOHELA STUDENT LN PPD ID: 1234567", label: "loan-payment" },
  { raw: "WEB PMT TOYOTA FINANCIAL SVC", label: "auto-loan" },
  { raw: "GM FINANCIAL AUTOPAY ACH", label: "auto-loan" },
  { raw: "SOFI LOAN PAYMENT ACH WEB", label: "loan-payment" },

  // --------------------------------------------------- business / advertising
  { raw: "FACEBK ADS *2ABC3DEF4 FB.ME/ADS CA", label: "advertising" },
  { raw: "GOOGLE *ADS4821221211 MOUNTAIN VIEW CA", label: "advertising" },
  { raw: "FEDEX OFFIC48212021 MEMPHIS TN", label: "business" },

  // ----------------------------------------------------- developer / software
  { raw: "AMAZON WEB SERVICES AWS.AMAZON.CO WA", label: "software" },
  { raw: "GITHUB, INC. 888-8899528 CA", label: "software" },

  // ------------------------------------------------------------ auto and DMV
  { raw: "TX DMV REGISTRATION FEE 512-4652000", label: "auto-registration" },
  { raw: "NC DMV LICENSE PLATE RALEIGH NC", label: "auto-registration" },
  { raw: "TAKE 5 OIL CHANGE #482 BATON ROUGE LA", label: "auto-maintenance" },
  { raw: "PURCHASE AUTHORIZED ON 06/20 JIFFY LUBE #2481 TUCSON AZ", label: "auto-maintenance" },

  // ---------------------------------------- fictional local merchants (clear)
  { raw: "JOE'S PIZZA #2 HOBOKEN NJ", label: "dining" },
  { raw: "SQ *MARIA'S TAQUERIA San Jose CA", label: "dining" },
  { raw: "TST* BIG EDS BBQ SHACK TULSA OK", label: "dining" },
  { raw: "POS DEBIT ROSIE'S DINER 42 AMARILLO TX", label: "dining" },
  { raw: "RIVERBEND AUTO REPAIR LLC CHATTANOOGA TN", label: "auto-maintenance" },
  { raw: "SUNSHINE NAILS & SPA GILBERT AZ", label: "personal-care" },
  { raw: "BLUE RIBBON CLEANERS DRY CLEANING TULSA OK", label: "personal-care" },
  { raw: "LAKESIDE VETERINARY CLINIC PLLC MADISON WI", label: "pets" },
  { raw: "HAPPY KIDS LEARNING CENTER LLC KATY TX", label: "childcare" },
  { raw: "GREEN THUMB LAWN CARE LLC 704-5551212", label: "lawn-garden" },
  { raw: "ACME PLUMBING & DRAIN 800-555-1212 OH", label: "home-services" },
  { raw: "SMITH & SONS ROOFING LLC INVOICE 4821", label: "home-services" },
  { raw: "THE BOOK NOOK ASHEVILLE NC", label: "books" },
  { raw: "VILLAGE FLORIST & GIFTS 0482 SALEM OR", label: "gifts" },
  { raw: "SQ *HARVEST MOON FARMERS MKT Ithaca NY", label: "groceries" },
  { raw: "TWIN PINES HARDWARE 208-5551212 ID", label: "home-improvement" },
  { raw: "CITYVIEW DENTAL GROUP PLLC EL PASO TX", label: "dental" },
  { raw: "ELM STREET COUNSELING PLLC 828-5551212", label: "mental-health" },
  { raw: "IRON WORKS GYM & BARBELL CLUB MONTHLY", label: "fitness" },
  { raw: "SMILE BRIGHT FAMILY DENTAL LLC PLANO TX", label: "dental" },

  // ------------------------------------ fictional local merchants (ambiguous)
  { raw: "K&M ENTERPRISES LLC", label: null },
  { raw: "JB HOLDINGS 0482", label: null },
  { raw: "TRISTAR SERVICES INC 800-4821221", label: null },
  { raw: "RJM GROUP LLC WEB PMT", label: null },
  { raw: "BLUE SKY VENTURES 512-5551212 TX", label: null },
  { raw: "DELTA DYNAMICS CORP 0482", label: null },
  { raw: "POS DEBIT M&T SOLUTIONS ROCHESTER NY", label: null },
  { raw: "CKE*APEX PARTNERS 0482", label: null },
  { raw: "IN *WILLOW CREEK LLC 800-5551212", label: null },
  { raw: "SP CEDAR & SAGE", label: null },
  { raw: "HKS INDUSTRIES PAYMENT 06/18", label: null },
  { raw: "FSP*NORTH POINT LLC", label: null },
  { raw: "PY *TOP TIER LLC 866-5551212", label: null },
  { raw: "CLOVER APP MKT CADENCE GROUP", label: null },

  // -------------------------------------------- extra messy bank-prefix forms
  { raw: "PURCHASE AUTHORIZED ON 06/10 WM SUPERC #0812 ROGERS AR CARD 9012", label: "shopping" },
  { raw: "DEBIT CARD PURCHASE - DUNKIN #360241 HARTFORD CT", label: "coffee" },
  { raw: "PURCHASE AUTHORIZED ON 06/21 DOLLAR GE #08321 MACON GA", label: "general-merchandise" },
  { raw: "POS DEBIT GOODWILL STORE #12 AKRON OH", label: "clothing" },
  { raw: "CHECKCARD 0617 PANDA EXPRESS #1482 FRESNO CA", label: "fast-food" },

  // ------------------------------------------------- adversarial (critic P2-6)
  // Collision probes from the #163 hostile-critic cycle: name/location words
  // that must NOT ride a category token, and outflow forms of income-side
  // descriptors (negative amountCents = a debit). Kept in the corpus so the
  // reported precision is measured against the traps, not only happy paths.
  { raw: "LOS BRAVOS JIMMY CARTER BLVD NORCROSS GA", label: null }, // restaurant on Jimmy Carter Blvd; no honest deterministic signal
  { raw: "CARTER BANK & TRUST MONTHLY FEE", label: "fees" },
  { raw: "CARTERS LAKE MARINA CHATSWORTH GA", label: null },
  { raw: "CAVA FALLS CHURCH VA", label: null }, // 'Falls Church' is a city, not a charity
  { raw: "PHO HOA #12 SAN JOSE CA", label: "dining" }, // PHO is a dining token; HOA must not win
  { raw: "HOA BINH MARKET GARDEN GROVE CA", label: "groceries" }, // a grocery market; the HOA token must not win (review is acceptable)
  { raw: "FIDELITY NATIONAL TITLE ESCROW 482", label: null },
  { raw: "PROGRESSIVE LEASING 877-898-1970 UT", label: null }, // rent-to-own installments — not auto insurance
  { raw: "GOODWILL INDUSTRIES #12 AKRON OH", label: "clothing" },
  { raw: "CARDMEMBER SERVICES INTEREST CHARGE", label: "fees" },
  { raw: "STRIPE TRANSFER ST-9QX2 DEBIT", label: null, amountCents: -120000 }, // balance clawback — must not book as income
  { raw: "BUILDIUM PAYMENT RENT", label: null, amountCents: -180000 }, // a tenant PAYING rent — must not book as rental income
  { raw: "GUSTO FEE 482113", label: null, amountCents: -4500 }, // employer SaaS fee — not a paycheck
  { raw: "INTEREST EARNED REVERSAL", label: null, amountCents: -12 },
];
