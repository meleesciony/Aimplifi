/**
 * Messy-descriptor corpus for the categorization baseline (PULSE_CATEGORIZATION_FIX
 * Phase 2). A realistic 60-day feed for a household: real-world merchants appearing
 * under MULTIPLE raw descriptor variants (processor prefixes, store numbers,
 * city/state suffixes), a mix of recurring bills, weekly habits, one-offs, and
 * genuinely ambiguous money movement (Zelle/checks/ATM).
 *
 * PURE data + deterministic builder (mulberry32, fixed seed) — same input ⇒ the
 * byte-identical dataset, so the Phase-2 baseline and the Phase-5 after-comparison
 * run on exactly the same feed. Descriptor style follows the hand-labeled
 * adversarial eval corpus (scripts/categorize-eval.ts, DECISIONS #55).
 *
 * `intended` is the INDEPENDENT human label (what the account owner would pick in
 * the current ~84-leaf taxonomy) — deliberately NOT copied from KNOWN_MERCHANTS,
 * so table-vs-human drift (e.g. Starbucks: table 'dining', human 'coffee') is
 * measured, not hidden.
 */

/** Baseline user credentials (shared by the seeder and the walkthrough driver). */
export const BASELINE_EMAIL = 'messy-baseline@aimplifi.test';
export const BASELINE_PASSWORD = 'baseline-pass-123';

export interface MessyMerchant {
  /** Human name (for reports only — the app derives its own canonical). */
  name: string;
  /** Independent human label: the category the owner would actually pick. */
  intended: string;
  /** Raw bank-feed descriptor variants this merchant appears under. */
  variants: string[];
  /** Occurrences per week (fractional ok) over the 60-day window. */
  perWeek: number;
  /** [min, max] absolute amount in cents; expenses are persisted negative. */
  amountCents: [number, number];
  /** Positive amounts (income) — default false. */
  inflow?: boolean;
  /** 'card' spends land on the credit card; default 'checking'. */
  account?: 'checking' | 'card';
  /** Fixed monthly bill: exactly one hit per ~30 days at a stable amount. */
  monthly?: boolean;
  /** One-off: exactly one occurrence in the window. */
  once?: boolean;
}

export const MESSY_MERCHANTS: MessyMerchant[] = [
  // ── daily/weekly habits (card) ──
  { name: 'Starbucks', intended: 'coffee', perWeek: 6, amountCents: [485, 1240], account: 'card',
    variants: ['STARBUCKS STORE 08321 SEATTLE WA', 'SQ *STARBUCKS #4471', 'STARBUCKS 800-782-7282 WA'] },
  { name: 'Anchorhead Coffee', intended: 'coffee', perWeek: 3, amountCents: [525, 980], account: 'card',
    variants: ['SQ *ANCHORHEAD COFFEE', 'SQ *ANCHORHEAD COFFE SEATTLE WA'] },
  { name: 'Amazon', intended: 'shopping', perWeek: 4, amountCents: [899, 14500], account: 'card',
    variants: ['AMZN Mktp US*RT4Y12', 'AMAZON.COM*M12AB34C AMZN.COM/BILL', 'Amazon Prime*5X8YZ WA'] },
  { name: 'Kroger (QFC)', intended: 'groceries', perWeek: 3, amountCents: [2400, 16800],
    variants: ['QFC #5847 SEATTLE WA', 'KROGER QFC 5847'] },
  { name: 'Safeway', intended: 'groceries', perWeek: 1, amountCents: [1900, 14300],
    variants: ['SAFEWAY #1647 SEATTLE WA', 'SAFEWAY STORE 00001647'] },
  { name: "Trader Joe's", intended: 'groceries', perWeek: 1, amountCents: [2200, 9800],
    variants: ["TRADER JOE'S #130 SEATTLE WA", 'TRADER JOES # 130 QPS'] },
  { name: 'Costco', intended: 'groceries', perWeek: 0.5, amountCents: [9800, 32400],
    variants: ['COSTCO WHSE #0110 SEATTLE WA'] },
  { name: 'Shell', intended: 'fuel', perWeek: 1, amountCents: [3800, 6900], account: 'card',
    variants: ['SHELL OIL 57444298100 SEATTLE', 'SHELL SERVICE STATION 4-49 WA'] },
  { name: 'Costco Gas', intended: 'fuel', perWeek: 0.5, amountCents: [4100, 6200],
    variants: ['COSTCO GAS #0110 SEATTLE WA'] },

  { name: "McDonald's", intended: 'fast-food', perWeek: 2, amountCents: [780, 1950], account: 'card',
    variants: ["MCDONALD'S F32814 SEATTLE WA", 'MCDONALDS 32814 QPS'] },
  { name: 'Arco', intended: 'fuel', perWeek: 1, amountCents: [3400, 5900], account: 'card',
    variants: ['ARCO#82641AMPM SEATTLE WA'] },

  // ── rides / parking (card) ──
  { name: 'Uber', intended: 'transport', perWeek: 3, amountCents: [1150, 4300], account: 'card',
    variants: ['UBER *TRIP HELP.UBER.COM', 'UBER TRIP 8005928996 CA'] },
  { name: 'Lyft', intended: 'transport', perWeek: 0.5, amountCents: [1300, 3800], account: 'card',
    variants: ['LYFT *RIDE THU 2PM', 'LYFT *2 RIDES 855-865-9553'] },
  { name: 'PayByPhone parking', intended: 'parking', perWeek: 3, amountCents: [250, 1200], account: 'card',
    variants: ['PAYBYPHONE *SEATTLE 87712', 'PBP*SEATTLE PARKING 877-727-5457'] },
  { name: 'WSDOT Ferry', intended: 'public-transit', once: true, perWeek: 0, amountCents: [1560, 1560],
    variants: ['WSDOT FERRY SEATTLE TERM'] },

  // ── eating out / delivery (card) ──
  { name: 'Uber Eats', intended: 'food-delivery', perWeek: 2, amountCents: [2400, 6800], account: 'card',
    variants: ['UBER *EATS PENDING', 'UBER EATS 8005928996 CA'] },
  { name: 'DoorDash', intended: 'food-delivery', perWeek: 2, amountCents: [2200, 7400], account: 'card',
    variants: ['DD *DOORDASH WENDYS', 'DOORDASH*CHIPOTLE 855-973-1040 CA'] },
  { name: 'Chipotle', intended: 'fast-food', perWeek: 2, amountCents: [1150, 2900], account: 'card',
    variants: ['CHIPOTLE 2831 ONLINE', 'CHIPOTLE ONLINE 1800244626 CA'] },
  { name: 'Chick-fil-A', intended: 'fast-food', perWeek: 2, amountCents: [980, 2600], account: 'card',
    variants: ['CHICK-FIL-A #01776 SEATTLE WA'] },
  { name: 'Walrus & Carpenter', intended: 'dining', perWeek: 0.5, amountCents: [6800, 16400], account: 'card',
    variants: ['TST* THE WALRUS AND THE CARPE', 'TST*WALRUS CARPENTER SEATTLE'] },
  { name: 'Seawolf Bakers', intended: 'coffee', perWeek: 2, amountCents: [850, 2400], account: 'card',
    variants: ['SQ *SEAWOLF BAKERS', 'SQ *SEAWOLF BAKERS SEATTLE WA'] },
  { name: 'Un Bien', intended: 'dining', perWeek: 0.5, amountCents: [2800, 5400], account: 'card',
    variants: ['SQ *UN BIEN BALLARD'] },
  { name: 'Thai Tom', intended: 'dining', perWeek: 0.5, amountCents: [2400, 4800], account: 'card',
    variants: ['TST* THAI TOM UNIVERSITY'] },

  // ── health / household / retail ──
  { name: 'CVS', intended: 'pharmacy', perWeek: 1, amountCents: [850, 6400], account: 'card',
    variants: ['CVS/PHARMACY #08123 SEATTLE WA', 'CVS/PHARM 08123--S'] },
  { name: 'Swedish Medical', intended: 'health', once: true, perWeek: 0, amountCents: [15500, 15500],
    variants: ['SWEDISH MEDICAL CENTER BILLPAY'] },
  { name: 'Home Depot', intended: 'home-improvement', perWeek: 1, amountCents: [1800, 21500], account: 'card',
    variants: ['THE HOME DEPOT #4712 SEATTLE', 'HOMEDEPOT.COM 800-430-3376 GA'] },
  { name: 'Target', intended: 'general-merchandise', perWeek: 1, amountCents: [2400, 12800], account: 'card',
    variants: ['TARGET 00028031 SEATTLE WA', 'TARGET.COM * 800-591-3869 MN'] },
  { name: 'REI', intended: 'hobbies', once: true, perWeek: 0, amountCents: [18900, 18900], account: 'card',
    variants: ['REI #11 SEATTLE FLAGSHIP'] },
  { name: 'Emerald City Cleaners', intended: 'personal-care', perWeek: 0.5, amountCents: [1800, 3600],
    variants: ['PY *EMERALD CITY CLEANERS'] },

  // ── monthly bills (checking) ──
  { name: 'Netflix', intended: 'subscriptions', monthly: true, perWeek: 0, amountCents: [1549, 1549],
    variants: ['NETFLIX.COM 866-579-7172 CA', 'Netflix 1 8665797172 CA'] },
  { name: 'Spotify', intended: 'subscriptions', monthly: true, perWeek: 0, amountCents: [1199, 1199],
    variants: ['SPOTIFY USA NEW YORK NY'] },
  { name: 'Comcast', intended: 'internet', monthly: true, perWeek: 0, amountCents: [8999, 8999],
    variants: ['COMCAST / XFINITY 800266278 WA', 'COMCAST CABLE COMM 800-COMCAST'] },
  { name: 'Seattle City Light', intended: 'utilities', monthly: true, perWeek: 0, amountCents: [11240, 14830],
    variants: ['SEATTLE CITY LIGHT BILLPAY', 'CITY OF SEATTLE LIGHT EPAY'] },
  { name: 'Puget Sound Energy', intended: 'utilities', monthly: true, perWeek: 0, amountCents: [6480, 9120],
    variants: ['PUGET SOUND ENERGY AUTOPAY'] },
  { name: 'T-Mobile', intended: 'phone', monthly: true, perWeek: 0, amountCents: [9500, 9500],
    variants: ['TMOBILE*AUTO PAY 800-937-8997', 'T-MOBILE PCS 08221'] },
  { name: 'Geico', intended: 'auto-insurance', monthly: true, perWeek: 0, amountCents: [14350, 14350],
    variants: ['GEICO *AUTO 800-841-3000'] },
  { name: 'Planet Fitness', intended: 'fitness', monthly: true, perWeek: 0, amountCents: [2499, 2499],
    variants: ['PLANET FIT 1234 MEMBERSHIP', 'PF *PLANET FITNESS 844-880-7180'] },
  { name: 'Adobe', intended: 'software', monthly: true, perWeek: 0, amountCents: [5999, 5999],
    variants: ['ADOBE *CREATIVE CLOUD 408-536'] },
  { name: 'GitHub', intended: 'software', monthly: true, perWeek: 0, amountCents: [400, 400],
    variants: ['GITHUB.COM HTTPSGITHUB CA'] },
  { name: 'Patreon', intended: 'entertainment', monthly: true, perWeek: 0, amountCents: [800, 800],
    variants: ['PATREON* MEMBERSHIP'] },
  { name: 'Apple', intended: 'subscriptions', monthly: true, perWeek: 0, amountCents: [999, 999],
    variants: ['APPLE.COM/BILL 866-712-7753 CA'] },
  { name: 'Delta Dental', intended: 'dental-insurance', monthly: true, perWeek: 0, amountCents: [5820, 5820],
    variants: ['DELTA DENTAL OF WA PREMIUM'] },

  // ── income (checking, positive) ──
  { name: 'Gusto payroll', intended: 'paycheck', perWeek: 0.5, amountCents: [412350, 412350], inflow: true,
    variants: ['GUSTO PAYROLL 9X8Y7Z DIRECT DEP'] },
  { name: 'Interest', intended: 'interest-income', monthly: true, perWeek: 0, amountCents: [1240, 1980], inflow: true,
    variants: ['INTEREST EARNED'] },

  // ── ambiguous money movement (checking) — the honest tail ──
  { name: 'Zelle to Marcus', intended: 'rent', perWeek: 0.5, amountCents: [92500, 92500],
    variants: ['ZELLE PAYMENT TO MARCUS CHEN'] },
  { name: 'Zelle to sitter', intended: 'childcare', perWeek: 0.5, amountCents: [8000, 12000],
    variants: ['ZELLE PAYMENT TO RILEY OKAFOR'] },
  { name: 'Venmo', intended: 'gifts', perWeek: 0.5, amountCents: [1500, 8600],
    variants: ['VENMO PAYMENT 1029384756', 'VENMO *PAYMENT 855-812-4430'] },
  { name: 'Checks', intended: 'home-services', perWeek: 0.5, amountCents: [12000, 24000],
    variants: ['CHECK #2041', 'CHECK #2042', 'CHECK #2043', 'CHECK #2044'] },
  { name: 'ATM', intended: 'cash', perWeek: 0.25, amountCents: [6000, 10000],
    variants: ['ATM WITHDRAWAL 4TH AVE BRANCH'] },
  { name: 'Service fee', intended: 'fees', monthly: true, perWeek: 0, amountCents: [1200, 1200],
    variants: ['MONTHLY SERVICE FEE'] },
];

/** Deterministic PRNG (same idiom as src/lib/seed/build.ts). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MessyTxn {
  id: string;
  accountId: string;
  providerRef: string;
  date: string; // YYYY-MM-DD
  amountCents: number;
  rawDescriptor: string;
  status: 'POSTED';
  isTransfer: boolean;
  /** side-channel ground truth (not persisted on the row) */
  intended: string;
  merchantName: string;
}

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 60;

function isoAddDays(asOf: string, minusDays: number): string {
  // Date-only arithmetic in UTC — no timezone-dependent business logic here
  // (tooling only; the app's date rules live in src/lib/dates.ts).
  const t = Date.UTC(
    Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)) - 1, Number(asOf.slice(8, 10)),
  ) - minusDays * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Expand the corpus into a deterministic 60-day feed ending at `asOf`.
 * checkingId/cardId are the two account ids the rows attach to.
 */
export function buildMessyTransactions(asOf: string, checkingId: string, cardId: string): MessyTxn[] {
  const rand = mulberry32(42);
  const txns: MessyTxn[] = [];
  let n = 0;

  const push = (m: MessyMerchant, dayAgo: number, variantIdx?: number) => {
    n += 1;
    const v = m.variants[variantIdx ?? Math.floor(rand() * m.variants.length)];
    const [lo, hi] = m.amountCents;
    const abs = lo === hi ? lo : lo + Math.floor(rand() * (hi - lo));
    txns.push({
      id: `mb-txn-${String(n).padStart(4, '0')}`,
      accountId: m.account === 'card' ? cardId : checkingId,
      providerRef: `mb-ref-${String(n).padStart(4, '0')}`,
      date: isoAddDays(asOf, Math.max(0, Math.min(WINDOW_DAYS - 1, dayAgo))),
      amountCents: m.inflow ? abs : -abs,
      rawDescriptor: v,
      status: 'POSTED',
      isTransfer: false,
      intended: m.intended,
      merchantName: m.name,
    });
  };

  for (const m of MESSY_MERCHANTS) {
    if (m.once) {
      push(m, Math.floor(rand() * WINDOW_DAYS));
    } else if (m.monthly) {
      // two hits ~30 days apart with a little jitter
      const first = 2 + Math.floor(rand() * 6);
      push(m, first);
      push(m, first + 30 + Math.floor(rand() * 3) - 1);
    } else if (m.name === 'Checks') {
      // sequential check numbers, one variant each, spread over the window
      m.variants.forEach((_, i) => push(m, 5 + i * 14 + Math.floor(rand() * 4), i));
    } else {
      const count = Math.round((m.perWeek * WINDOW_DAYS) / 7);
      for (let i = 0; i < count; i += 1) {
        // spread occurrence i into its own slice of the window + jitter
        const slice = WINDOW_DAYS / count;
        push(m, Math.floor(i * slice + rand() * slice));
      }
    }
  }

  // stable order: newest first (matches the queue's date desc)
  txns.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
  return txns;
}
