/**
 * Deterministic seed-data builder — the PURE core of `prisma/seed.ts`.
 *
 * Same `asOf` ⇒ byte-identical dataset (fixed-seed PRNG, deterministic ids,
 * no Date.now()). The exact current-cycle numbers here are pinned by hand math
 * in docs/EDGE_CASES.md §Seed-headline — if you change them, redo the math on
 * paper and update BOTH files.
 *
 * Spec: docs/SEED_SPEC.md.
 */

import { type Cents, cents } from '@/lib/money';
import {
  type ISODate,
  addDays,
  addMonthsClamped,
  compareDates,
  daysInMonth,
  isoDate,
} from '@/lib/dates';

// ── deterministic PRNG (mulberry32) ─────────────────────────────────────────

function hashString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── output shapes (plain rows, ready for Prisma createMany) ─────────────────

export interface SeedUser {
  id: string;
  email: string;
  name: string;
  hourlyWageCents: number;
  swrBps: number;
  expectedReturnBps: number;
  moneyDials: string; // JSON-encoded string[]
  paymentAccountId: string;
}

export interface SeedAccount {
  id: string;
  userId: string;
  provider: 'demo';
  name: string;
  type: 'CHECKING' | 'SAVINGS' | 'CREDIT' | 'INVESTMENT' | 'LOAN';
  mask: string;
  currentBalanceCents: number;
  creditLimitCents: number | null;
  aprBps: number | null;
  minimumPaymentCents: number | null;
  dueDayOfMonth: number | null;
  cycleCloseDayOfMonth: number | null;
}

export interface SeedAutopay {
  id: string;
  accountId: string;
  mode: 'STATEMENT_BALANCE' | 'MINIMUM' | 'FIXED_AMOUNT';
  fixedAmountCents: number | null;
}

export interface SeedStatement {
  id: string;
  accountId: string;
  cycleStart: ISODate;
  cycleEnd: ISODate;
  dueDate: ISODate;
  statementBalanceCents: number;
  minimumPaymentCents: number;
  isEstimated: boolean;
}

export interface SeedCardPayment {
  id: string;
  statementId: string;
  date: ISODate;
  amountCents: number;
  source: 'manual' | 'autopay';
}

export interface SeedTransaction {
  id: string;
  accountId: string;
  date: ISODate;
  amountCents: number; // outflow negative, inflow positive
  rawDescriptor: string;
  status: 'PENDING' | 'POSTED';
  isTransfer: boolean;
}

export interface SeedScheduled {
  id: string;
  accountId: string;
  description: string;
  amountCents: number;
  nextDate: ISODate;
  cadence: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | null;
  source: string;
}

export interface SeedSnapshot {
  id: string;
  accountId: string;
  date: ISODate;
  balanceCents: number;
}

export interface SeedHolding {
  id: string;
  accountId: string;
  symbol: string;
  name: string;
  quantity: number; // shares (may be fractional)
  costBasisCents: number; // total invested
  priceCents: number; // current price per share
}

export interface SeedData {
  asOf: ISODate;
  user: SeedUser;
  accounts: SeedAccount[];
  autopays: SeedAutopay[];
  statements: SeedStatement[];
  cardPayments: SeedCardPayment[];
  transactions: SeedTransaction[];
  scheduled: SeedScheduled[];
  snapshots: SeedSnapshot[];
  holdings: SeedHolding[];
}

// ── descriptor pool (≥40 distinct messy raw forms; docs/SEED_SPEC.md) ───────

type Bucket = 'dining' | 'shopping' | 'grocery' | 'fuel' | 'travel' | 'misc';

const DISCRETIONARY: { raw: string; bucket: Bucket; min: number; max: number }[] = [
  { raw: 'SQ *BLUE BOTTLE 0042 OAK', bucket: 'dining', min: 450, max: 1400 },
  { raw: 'SQ *PONCE CITY DONUTS ATL', bucket: 'dining', min: 600, max: 1800 },
  { raw: 'TST* HATTIE BS - ATL', bucket: 'dining', min: 1800, max: 5200 },
  { raw: 'TST* FOX BROS BBQ ATLANTA GA', bucket: 'dining', min: 2400, max: 7800 },
  { raw: 'AMZN Mktp US*2K4XY1', bucket: 'shopping', min: 900, max: 9500 },
  { raw: 'AMZN Mktp US*9Q7TR3', bucket: 'shopping', min: 1200, max: 14000 },
  { raw: 'AMAZON.COM*PR1ME 8821', bucket: 'shopping', min: 800, max: 6000 },
  { raw: 'PAYPAL *ETSY INC SELLER', bucket: 'shopping', min: 1500, max: 8800 },
  { raw: 'HMSHOST-ATL-T4-POS118', bucket: 'dining', min: 1100, max: 3400 },
  { raw: 'COSTCO GAS #1234 ATLANTA', bucket: 'fuel', min: 3200, max: 6800 },
  { raw: 'COSTCO WHSE #1234 ATLANTA', bucket: 'grocery', min: 8500, max: 28000 },
  { raw: 'UBER *TRIP HELP.UBER.COM', bucket: 'travel', min: 900, max: 4200 },
  { raw: 'UBER *EATS PENDING.UBER.CO', bucket: 'dining', min: 1800, max: 5600 },
  { raw: 'KROGER #688 ATLANTA GA', bucket: 'grocery', min: 3200, max: 16500 },
  { raw: 'PUBLIX SUPER MAR 1893 ATL', bucket: 'grocery', min: 2800, max: 14800 },
  { raw: 'WM SUPERCENTER #2841', bucket: 'shopping', min: 2200, max: 12500 },
  { raw: 'TARGET T-1893 ATLANTA GAUS', bucket: 'shopping', min: 1800, max: 11000 },
  { raw: 'CHICK-FIL-A #02034', bucket: 'dining', min: 850, max: 2600 },
  { raw: 'SHELL OIL 57544221800', bucket: 'fuel', min: 2800, max: 6200 },
  { raw: 'QT 712 OUTSIDE ATLANTA GA', bucket: 'fuel', min: 2400, max: 5800 },
  { raw: 'DELTA AIR 0062341022334', bucket: 'travel', min: 18500, max: 48000 },
  { raw: 'MARRIOTT ATLANTA MARQ', bucket: 'travel', min: 14500, max: 38000 },
  { raw: 'AIRBNB * HM8Q2X PAYMENTS', bucket: 'travel', min: 16000, max: 42000 },
  { raw: 'LYFT *RIDE THU 9PM', bucket: 'travel', min: 800, max: 3600 },
  { raw: "MCDONALD'S F13339", bucket: 'dining', min: 650, max: 1900 },
  { raw: 'STARBUCKS 800-782-7282', bucket: 'dining', min: 500, max: 1600 },
  { raw: 'CVS/PHARM 04733--1100 P', bucket: 'misc', min: 800, max: 4500 },
  { raw: 'WALGREENS #6332', bucket: 'misc', min: 600, max: 3800 },
  { raw: 'HOME DEPOT #0121', bucket: 'shopping', min: 1500, max: 18500 },
  { raw: 'LOWES #02748*', bucket: 'shopping', min: 1400, max: 16000 },
  { raw: 'WAFFLE HOUSE 1042 ATL', bucket: 'dining', min: 900, max: 2400 },
  { raw: 'TRADER JOE S #735', bucket: 'grocery', min: 2400, max: 9800 },
  { raw: 'CHEVRON 0093552 SMYRNA', bucket: 'fuel', min: 2600, max: 6000 },
  { raw: 'ATM WITHDRAWAL 00482 PEACHTREE ST', bucket: 'misc', min: 4000, max: 12000 },
  { raw: 'SPIRIT HALLOWEEN 80012', bucket: 'shopping', min: 1800, max: 7500 },
];

const CREEP_BUCKETS: Bucket[] = ['dining', 'shopping'];

interface Subscription {
  raw: string;
  amountCents: (month: ISODate) => number;
  day: number;
  accountId: string;
}

// ── main builder ─────────────────────────────────────────────────────────────

export const DEFAULT_AS_OF = '2026-06-10';

export function buildSeedData(asOfStr: string = DEFAULT_AS_OF): SeedData {
  const asOf = isoDate(asOfStr);
  const rand = mulberry32(hashString(`pulse-finance-seed:${asOf}`));
  const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

  let txnCounter = 0;
  const transactions: SeedTransaction[] = [];
  const addTxn = (
    accountId: string,
    date: ISODate,
    amountCents: number,
    rawDescriptor: string,
    opts: { status?: 'PENDING' | 'POSTED'; isTransfer?: boolean } = {},
  ) => {
    transactions.push({
      id: `txn-${String(++txnCounter).padStart(5, '0')}`,
      accountId,
      date,
      amountCents,
      rawDescriptor,
      status: opts.status ?? 'POSTED',
      isTransfer: opts.isTransfer ?? false,
    });
  };

  const historyStart = addMonthsClamped(asOf, -18);

  // ── user & accounts ──
  const user: SeedUser = {
    id: 'user-demo',
    email: 'demo@pulse.finance',
    name: 'Demo User',
    hourlyWageCents: 3800,
    swrBps: 400,
    expectedReturnBps: 700,
    moneyDials: JSON.stringify(['Travel', 'Dining Out']),
    paymentAccountId: 'acct-checking',
  };

  const accounts: SeedAccount[] = [
    { id: 'acct-checking', userId: user.id, provider: 'demo', name: 'Everyday Checking', type: 'CHECKING', mask: '4421', currentBalanceCents: 340000, creditLimitCents: null, aprBps: null, minimumPaymentCents: null, dueDayOfMonth: null, cycleCloseDayOfMonth: null },
    { id: 'acct-savings', userId: user.id, provider: 'demo', name: 'High-Yield Savings', type: 'SAVINGS', mask: '9907', currentBalanceCents: 1850000, creditLimitCents: null, aprBps: null, minimumPaymentCents: null, dueDayOfMonth: null, cycleCloseDayOfMonth: null },
    { id: 'acct-joint', userId: user.id, provider: 'demo', name: 'Joint Checking', type: 'CHECKING', mask: '3318', currentBalanceCents: 120000, creditLimitCents: null, aprBps: null, minimumPaymentCents: null, dueDayOfMonth: null, cycleCloseDayOfMonth: null },
    { id: 'acct-sapphire', userId: user.id, provider: 'demo', name: 'Sapphire Card', type: 'CREDIT', mask: '7710', currentBalanceCents: 294811, creditLimitCents: 1800000, aprBps: 2499, minimumPaymentCents: null, dueDayOfMonth: 15, cycleCloseDayOfMonth: 18 },
    { id: 'acct-platinum', userId: user.id, provider: 'demo', name: 'Platinum Card', type: 'CREDIT', mask: '1005', currentBalanceCents: 226045, creditLimitCents: 2500000, aprBps: 2924, minimumPaymentCents: null, dueDayOfMonth: 15, cycleCloseDayOfMonth: 21 },
    { id: 'acct-freedom', userId: user.id, provider: 'demo', name: 'Freedom Card', type: 'CREDIT', mask: '5523', currentBalanceCents: 74320, creditLimitCents: 1200000, aprBps: 1999, minimumPaymentCents: null, dueDayOfMonth: 28, cycleCloseDayOfMonth: 1 },
    { id: 'acct-store', userId: user.id, provider: 'demo', name: 'Store Card', type: 'CREDIT', mask: '0064', currentBalanceCents: 4350, creditLimitCents: 300000, aprBps: 3199, minimumPaymentCents: null, dueDayOfMonth: 15, cycleCloseDayOfMonth: 20 },
    { id: 'acct-brokerage', userId: user.id, provider: 'demo', name: 'Brokerage', type: 'INVESTMENT', mask: '8842', currentBalanceCents: 14200000, creditLimitCents: null, aprBps: null, minimumPaymentCents: null, dueDayOfMonth: null, cycleCloseDayOfMonth: null },
    { id: 'acct-autoloan', userId: user.id, provider: 'demo', name: 'Auto Loan', type: 'LOAN', mask: '6619', currentBalanceCents: 1430000, creditLimitCents: null, aprBps: 649, minimumPaymentCents: 38500, dueDayOfMonth: 5, cycleCloseDayOfMonth: null },
  ];

  const autopays: SeedAutopay[] = [
    { id: 'autopay-platinum', accountId: 'acct-platinum', mode: 'STATEMENT_BALANCE', fixedAmountCents: null },
  ];

  // ── payroll: biweekly Fridays +$2,450, anchored on 2026-06-12 ──
  // (asOf-relative: the most recent payroll Friday on/before asOf+2; with the
  //  default asOf this is exactly 2026-06-12 per EDGE_CASES §Seed-headline.)
  let anchor = isoDate('2026-06-12');
  // generalize for non-default asOf: walk anchor into [asOf-12, asOf+2]
  while (compareDates(anchor, addDays(asOf, 2)) > 0) anchor = addDays(anchor, -14);
  while (compareDates(addDays(anchor, 14), addDays(asOf, 2)) <= 0) anchor = addDays(anchor, 14);

  const payrollDates: ISODate[] = [];
  for (let p = anchor; compareDates(p, historyStart) >= 0; p = addDays(p, -14)) {
    payrollDates.push(p);
  }
  payrollDates.reverse();
  for (const p of payrollDates) {
    if (compareDates(p, asOf) <= 0) {
      addTxn('acct-checking', p, 245000, 'ACH DEPOSIT ACME ANALYTICS PAYROLL');
    }
  }

  // ── rent: −$1,800, 2 days before the LAST payroll Friday of each month ──
  const rentDates: ISODate[] = [];
  {
    const lastFridayOfMonth = new Map<string, ISODate>();
    const future = [addDays(anchor, 14), addDays(anchor, 28)];
    for (const p of [...payrollDates, ...future]) {
      lastFridayOfMonth.set(p.slice(0, 7), p);
    }
    for (const p of lastFridayOfMonth.values()) {
      const rentDay = addDays(p, -2);
      if (compareDates(rentDay, historyStart) >= 0) rentDates.push(rentDay);
    }
    rentDates.sort(compareDates);
  }
  for (const r of rentDates) {
    if (compareDates(r, asOf) <= 0) {
      addTxn('acct-checking', r, -180000, 'ACH WITHDRAWAL PEACHTREE PROPERTIES RENT');
    }
  }
  const nextRent = rentDates.find((r) => compareDates(r, asOf) > 0)!;

  // ── monthly transfers & loan payment ──
  const monthCursor = (day: number): ISODate[] => {
    const out: ISODate[] = [];
    let m = isoDate(`${historyStart.slice(0, 7)}-01`);
    for (let i = 0; i < 20; i++) {
      const dd = Math.min(day, daysInMonth(+m.slice(0, 4), +m.slice(5, 7)));
      const date = isoDate(`${m.slice(0, 7)}-${String(dd).padStart(2, '0')}`);
      if (compareDates(date, historyStart) >= 0) out.push(date);
      m = addMonthsClamped(m, 1);
    }
    return out;
  };

  for (const t of monthCursor(1)) {
    if (compareDates(t, asOf) <= 0) {
      addTxn('acct-checking', t, -50000, 'ONLINE TRANSFER TO HIGH-YIELD SAVINGS X9907', { isTransfer: true });
      addTxn('acct-savings', t, 50000, 'ONLINE TRANSFER FROM CHECKING X4421', { isTransfer: true });
    }
  }
  for (const t of monthCursor(5)) {
    if (compareDates(t, asOf) <= 0) {
      addTxn('acct-checking', t, -38500, 'ACH WITHDRAWAL CARMAX AUTO FIN 4421', { isTransfer: true });
    }
  }

  // ── subscriptions (≥8; Netflix price increase; unused gym) ──
  const netflixIncreaseMonth = addMonthsClamped(asOf, -4).slice(0, 7); // '2026-02'
  const subscriptions: Subscription[] = [
    { raw: 'PAYPAL *SPOTIFYUSA', day: 7, accountId: 'acct-checking', amountCents: () => -1199 },
    { raw: 'NETFLIX.COM 866-579-7172', day: 3, accountId: 'acct-freedom', amountCents: (m) => (m.slice(0, 7) >= netflixIncreaseMonth ? -1799 : -1549) },
    { raw: 'LA FITNESS MEMBERSHIP DUES', day: 9, accountId: 'acct-sapphire', amountCents: () => -3499 },
    { raw: 'APPLE.COM/BILL 866-712-7753', day: 12, accountId: 'acct-platinum', amountCents: () => -299 },
    { raw: 'GOOGLE *YOUTUBEPREMIUM g.co', day: 16, accountId: 'acct-platinum', amountCents: () => -1399 },
    { raw: 'HELLOFRESH* 3 MEALS', day: 22, accountId: 'acct-sapphire', amountCents: () => -6299 },
    { raw: 'GEICO *AUTO 800-841-3000', day: 20, accountId: 'acct-platinum', amountCents: () => -14250 },
    { raw: 'COMCAST / XFINITY 800-COMCAST', day: 18, accountId: 'acct-freedom', amountCents: () => -7999 },
  ];
  for (const sub of subscriptions) {
    for (const t of monthCursor(sub.day)) {
      if (compareDates(t, asOf) <= 0) addTxn(sub.accountId, t, sub.amountCents(t), sub.raw);
    }
  }

  // ── discretionary spend with engineered lifestyle creep ──
  // Final 6 months: dining+shopping grows ~4%/month while payroll stays flat.
  const creepStartMonth = addMonthsClamped(asOf, -6).slice(0, 7); // '2025-12'
  const monthsSince = (ym: string, base: string) =>
    (+ym.slice(0, 4) - +base.slice(0, 4)) * 12 + (+ym.slice(5, 7) - +base.slice(5, 7));
  const spendAccounts = ['acct-sapphire', 'acct-platinum', 'acct-freedom', 'acct-checking', 'acct-joint'];

  let m = isoDate(`${historyStart.slice(0, 7)}-01`);
  while (compareDates(m, asOf) <= 0) {
    const ym = m.slice(0, 7);
    const k = monthsSince(ym, creepStartMonth);
    const creepFactor = k > 0 ? Math.pow(1.04, k) : 1;
    const baseCount = 24;
    const count = k > 0 ? baseCount + k : baseCount; // a few extra outings per creep month
    for (let i = 0; i < count; i++) {
      const desc = DISCRETIONARY[randInt(0, DISCRETIONARY.length - 1)];
      const day = randInt(1, daysInMonth(+m.slice(0, 4), +m.slice(5, 7)));
      const date = isoDate(`${ym}-${String(day).padStart(2, '0')}`);
      if (compareDates(date, historyStart) < 0 || compareDates(date, asOf) > 0) continue;
      let amount = randInt(desc.min, desc.max);
      if (CREEP_BUCKETS.includes(desc.bucket)) amount = Math.round(amount * creepFactor);
      const account = spendAccounts[randInt(0, spendAccounts.length - 1)];
      addTxn(account, date, -amount, desc.raw);
    }
    m = addMonthsClamped(m, 1);
  }

  // ── occasional genuinely-ambiguous items (checks, Zelle) ──
  // Sparse and realistic: one personal check every other month (incrementing
  // numbers) and a Zelle every third month. These are the items that SHOULD
  // land in the triage inbox — kept rare so the 60-day review rate stays <5%.
  {
    let checkNo = 1031;
    let i = 0;
    for (const t of monthCursor(18)) {
      i++;
      if (compareDates(t, asOf) > 0) continue;
      if (i % 2 === 0) addTxn('acct-checking', t, -randInt(5000, 22000), `CHECK #${++checkNo}`);
      if (i % 3 === 0) addTxn('acct-checking', t, -randInt(2000, 12000), 'ZELLE PAYMENT TO J. PARK');
    }
  }

  // ── statements: 18 months per card; current cycle pinned to EDGE_CASES values ──
  const statements: SeedStatement[] = [];
  const cardPayments: SeedCardPayment[] = [];
  let stmtCounter = 0;
  let payCounter = 0;

  const minPayment = (balance: number) => (balance <= 0 ? 0 : Math.max(3500, Math.round(balance / 100)));

  interface CardCfg {
    accountId: string;
    closeDay: number;
    dueDay: number; // in the month AFTER close (close 18th → due 15th next month, etc.)
    range: [number, number];
    payDescriptor: string;
  }
  const histCards: CardCfg[] = [
    { accountId: 'acct-sapphire', closeDay: 18, dueDay: 15, range: [80000, 320000], payDescriptor: 'CHASE EPAY SAPPHIRE' },
    { accountId: 'acct-platinum', closeDay: 21, dueDay: 15, range: [60000, 260000], payDescriptor: 'AMEX EPAYMENT PLATINUM' },
    { accountId: 'acct-freedom', closeDay: 1, dueDay: 28, range: [30000, 140000], payDescriptor: 'CHASE EPAY FREEDOM' },
  ];

  const pinned: Record<string, { balance: number; cycleEnd: ISODate; dueDate: ISODate }> = {
    'acct-sapphire': { balance: 271233, cycleEnd: isoDate('2026-05-18'), dueDate: isoDate('2026-06-15') },
    'acct-platinum': { balance: 210000, cycleEnd: isoDate('2026-05-21'), dueDate: isoDate('2026-06-15') },
    'acct-freedom': { balance: 100000, cycleEnd: isoDate('2026-06-01'), dueDate: isoDate('2026-06-28') },
  };

  for (const cfg of histCards) {
    const pin = pinned[cfg.accountId];
    for (let back = 0; back < 18; back++) {
      const cycleEnd = addMonthsClamped(pin.cycleEnd, -back);
      if (compareDates(cycleEnd, historyStart) < 0) continue;
      const cycleStart = addDays(addMonthsClamped(cycleEnd, -1), 1);
      const dueDate = addMonthsClamped(pin.dueDate, -back);
      const balance = back === 0 ? pin.balance : randInt(cfg.range[0], cfg.range[1]);
      const id = `stmt-${String(++stmtCounter).padStart(4, '0')}`;
      statements.push({
        id,
        accountId: cfg.accountId,
        cycleStart,
        cycleEnd,
        dueDate,
        statementBalanceCents: balance,
        minimumPaymentCents: minPayment(balance),
        isEstimated: false,
      });
      if (back === 0) continue; // current statement: payment handling below
      // historical statements paid in full on the due date
      cardPayments.push({
        id: `pay-${String(++payCounter).padStart(4, '0')}`,
        statementId: id,
        date: dueDate,
        amountCents: balance,
        source: cfg.accountId === 'acct-platinum' ? 'autopay' : 'manual',
      });
      if (compareDates(dueDate, asOf) <= 0 && compareDates(dueDate, historyStart) >= 0) {
        addTxn('acct-checking', dueDate, -balance, cfg.payDescriptor, { isTransfer: true });
        addTxn(cfg.accountId, dueDate, balance, 'PAYMENT THANK YOU', { isTransfer: true });
      }
    }
  }

  // Freedom: mid-cycle manual payment of $400 against the CURRENT statement (edge case B)
  const freedomCurrent = statements.find(
    (s) => s.accountId === 'acct-freedom' && s.cycleEnd === pinned['acct-freedom'].cycleEnd,
  )!;
  const freedomPayDate = isoDate('2026-06-05');
  cardPayments.push({
    id: `pay-${String(++payCounter).padStart(4, '0')}`,
    statementId: freedomCurrent.id,
    date: freedomPayDate,
    amountCents: 40000,
    source: 'manual',
  });
  addTxn('acct-checking', freedomPayDate, -40000, 'CHASE EPAY FREEDOM', { isTransfer: true });
  addTxn('acct-freedom', freedomPayDate, 40000, 'PAYMENT THANK YOU', { isTransfer: true });

  // Sapphire: $50 refund 2 days AFTER the current statement close (edge case F)
  addTxn('acct-sapphire', addDays(pinned['acct-sapphire'].cycleEnd, 2), 5000, 'AMZN Mktp US*REFUND 2K4XY1');

  // Store Card: sparse history with $0-due cycles; NO current statement (estimate path,
  // edge case C). Last generated statement closed asOf−2 months with a small balance,
  // paid; the cycle that would have closed last month had $0 activity → skipped.
  {
    const storeClose = isoDate('2026-04-20');
    const storeDue = isoDate('2026-05-15');
    for (let back = 0; back < 16; back += 2) {
      const cycleEnd = addMonthsClamped(storeClose, -back);
      if (compareDates(cycleEnd, historyStart) < 0) continue;
      const dueDate = addMonthsClamped(storeDue, -back);
      const balance = back === 6 || back === 12 ? 0 : randInt(2500, 18000);
      const id = `stmt-${String(++stmtCounter).padStart(4, '0')}`;
      statements.push({
        id,
        accountId: 'acct-store',
        cycleStart: addDays(addMonthsClamped(cycleEnd, -2), 1),
        cycleEnd,
        dueDate,
        statementBalanceCents: balance,
        minimumPaymentCents: minPayment(balance),
        isEstimated: false,
      });
      if (balance > 0) {
        cardPayments.push({
          id: `pay-${String(++payCounter).padStart(4, '0')}`,
          statementId: id,
          date: dueDate,
          amountCents: balance,
          source: 'manual',
        });
        if (compareDates(dueDate, asOf) <= 0 && compareDates(dueDate, historyStart) >= 0) {
          addTxn('acct-checking', dueDate, -balance, 'SYNCB STORE CARD PAYMENT', { isTransfer: true });
          addTxn('acct-store', dueDate, balance, 'PAYMENT THANK YOU', { isTransfer: true });
        }
      }
    }
    // the purchase that creates the Store card's current $43.50 balance
    addTxn('acct-store', isoDate('2026-06-02'), -4350, 'STORE CARD PURCHASE 0064 ATL');
  }

  // ── pending transactions at asOf (≥3, incl. −$250.00 on the payment account) ──
  addTxn('acct-checking', asOf, -25000, 'ZELLE PAYMENT TO GREENLEAF LAWN CARE', { status: 'PENDING' });
  addTxn('acct-sapphire', asOf, -675, 'SQ *BLUE BOTTLE 0042 OAK', { status: 'PENDING' });
  addTxn('acct-platinum', addDays(asOf, -1), -4318, 'AMZN Mktp US*2K4XY1', { status: 'PENDING' });

  // ── scheduled transactions (known future flows feeding the projection) ──
  const nextPayroll = addDays(anchor, compareDates(anchor, asOf) > 0 ? 0 : 14);
  const firstFuture = (dates: ISODate[]) => dates.find((t) => compareDates(t, asOf) > 0)!;
  const scheduled: SeedScheduled[] = [
    { id: 'sched-payroll', accountId: 'acct-checking', description: 'Payroll — Acme Analytics', amountCents: 245000, nextDate: compareDates(anchor, asOf) >= 0 ? anchor : nextPayroll, cadence: 'BIWEEKLY', source: 'seed' },
    { id: 'sched-rent', accountId: 'acct-checking', description: 'Rent — Peachtree Properties', amountCents: -180000, nextDate: nextRent, cadence: 'MONTHLY', source: 'seed' },
    { id: 'sched-savings', accountId: 'acct-checking', description: 'Auto-transfer to savings', amountCents: -50000, nextDate: firstFuture(monthCursor(1)), cadence: 'MONTHLY', source: 'seed' },
    { id: 'sched-autoloan', accountId: 'acct-checking', description: 'Auto loan — CarMax', amountCents: -38500, nextDate: firstFuture(monthCursor(5)), cadence: 'MONTHLY', source: 'seed' },
  ];

  // ── month-end balance snapshots (net-worth trend) ──
  const snapshots: SeedSnapshot[] = [];
  let snapCounter = 0;
  const drift: Record<string, { start: number; end: number; noise: number }> = {
    'acct-checking': { start: 290000, end: 340000, noise: 60000 },
    'acct-savings': { start: 1480000, end: 1850000, noise: 25000 },
    'acct-joint': { start: 95000, end: 120000, noise: 20000 },
    'acct-sapphire': { start: 210000, end: 294811, noise: 70000 },
    'acct-platinum': { start: 180000, end: 226045, noise: 60000 },
    'acct-freedom': { start: 90000, end: 74320, noise: 30000 },
    'acct-store': { start: 8000, end: 4350, noise: 6000 },
    'acct-brokerage': { start: 10650000, end: 14200000, noise: 350000 },
    'acct-autoloan': { start: 2030000, end: 1430000, noise: 8000 },
  };
  for (const acct of accounts) {
    const d = drift[acct.id];
    for (let back = 17; back >= 0; back--) {
      const monthStart = addMonthsClamped(isoDate(`${asOf.slice(0, 7)}-01`), -back);
      const y = +monthStart.slice(0, 4);
      const mo = +monthStart.slice(5, 7);
      // current month's snapshot is dated asOf (never a future month-end)
      const date =
        back === 0
          ? asOf
          : isoDate(`${monthStart.slice(0, 7)}-${String(daysInMonth(y, mo)).padStart(2, '0')}`);
      const progress = (17 - back) / 17;
      const base = d.start + (d.end - d.start) * progress;
      const noise = (rand() - 0.5) * d.noise * (back === 0 ? 0 : 1);
      snapshots.push({
        id: `snap-${String(++snapCounter).padStart(4, '0')}`,
        accountId: acct.id,
        date,
        balanceCents: Math.max(0, Math.round(base + noise)),
      });
    }
  }

  transactions.sort((a, b) => compareDates(a.date, b.date) || a.id.localeCompare(b.id));

  // ── investment holdings: a position breakdown of the Brokerage (acct-brokerage),
  // summing to its $142,000.00 market value, with cost bases that show realistic gains
  // (DECISIONS #78). Fixed/asOf-independent — a deterministic demo portfolio. Market
  // values: 5,700,000 + 2,500,000 + 2,160,000 + 2,400,000 + 1,440,000 = 14,200,000
  // (= acct-brokerage.currentBalanceCents); cost 10,700,000 → +$35,000.00 (+32.71%). ──
  const holdings: SeedHolding[] = [
    { id: 'hold-vti', accountId: 'acct-brokerage', symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', quantity: 200, costBasisCents: 4400000, priceCents: 28500 },
    { id: 'hold-vxus', accountId: 'acct-brokerage', symbol: 'VXUS', name: 'Vanguard Total International Stock ETF', quantity: 400, costBasisCents: 2200000, priceCents: 6250 },
    { id: 'hold-bnd', accountId: 'acct-brokerage', symbol: 'BND', name: 'Vanguard Total Bond Market ETF', quantity: 300, costBasisCents: 2300000, priceCents: 7200 },
    { id: 'hold-aapl', accountId: 'acct-brokerage', symbol: 'AAPL', name: 'Apple Inc.', quantity: 100, costBasisCents: 1200000, priceCents: 24000 },
    { id: 'hold-nvda', accountId: 'acct-brokerage', symbol: 'NVDA', name: 'NVIDIA Corp.', quantity: 30, costBasisCents: 600000, priceCents: 48000 },
  ];

  return {
    asOf,
    user,
    accounts,
    autopays,
    statements,
    cardPayments,
    transactions,
    scheduled,
    snapshots,
    holdings,
  };
}

/** FNV-1a checksum over a stable serialization — used by the determinism test. */
export function seedChecksum(data: SeedData): string {
  const s = JSON.stringify(data);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export type { Cents };
export { cents };
