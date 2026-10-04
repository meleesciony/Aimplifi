/**
 * Regular pay — the income that plans the month (owner, DECISIONS #784/#785).
 *
 * WHY THIS EXISTS. The guilt-free income basis is the MEDIAN of the last three
 * complete calendar months (L.22). A median of calendar months is immune to a
 * one-time deposit, which is why it was chosen, but for a steady payroll it also
 * throws out what the reader's pay really does: a biweekly payroll lands THREE
 * times in two months of every year, so the plan ran on "two paychecks and
 * nothing else" — below what the reader earns over a year. Owner: "Base pay plans
 * the month … you never plan monthly spending on money that only arrives 4 times
 * a year", and "the base app has to cover everyone".
 *
 * THE RULE — ONE STEADY PAYCHECK, OR THE OLD BASIS. Regular pay plans the month
 * ONLY when one steady paycheck clearly explains the household's recent pay:
 *   1. exactly ONE steady paycheck is still arriving (none → nothing to plan on;
 *      two or more → the old basis);
 *   2. it has paid WITHOUT A BREAK since before the three-month window (no new
 *      job, no seasonal restart inside it);
 *   3. it has held one level — its last eight paychecks agree within 2%, the
 *      newest payday is an ordinary paycheck, and no smaller deposit from the
 *      payroll has arrived since (a raise, a cut or a run of overtime is a change);
 *   4. no other steady payroll stopped inside the window (no job just ended);
 *   5. everything else counted as pay — other payers, and the payroll's own
 *      unusual deposits — is no more than 10% of a usual month's paychecks (two
 *      every-two-weeks or twice-a-month paychecks, four weekly, one monthly).
 * Then income = the paycheck at its yearly rate + that small usual remainder.
 * Every other household — a second paycheck, a job change, a raise or cut of
 * more than 2%, overtime, a pension or a spouse's salary filed Income, a side
 * gig, seasonal or varying hourly pay — keeps the median EXACTLY as before.
 *
 * HOW IT GOT HERE (owner decisions at three human gates, 2026-10-04). Five critic
 * cycles of a design that modelled every messy household each found a new way
 * for it to be wrong (composition dropping a pension; job changes
 * double-counting; a "stopped" rule dropping a raise) → the fail-closed rule.
 * Cycle 6 found two holes in "clearly" (a paycheck that stepped down read at its
 * old level; a seasonal job counted from its first-ever payday) → conditions 2
 * and 3. Cycle 7 found a SECOND payroll's raised paydays counted twice (its old
 * paycheck as a stream and each raised payday whole as "other") → condition 1:
 * most of seven cycles' P1s lived in how two payrolls interact, and the owner
 * chose to plan on regular pay only where there is one.
 *
 * WHY NOT `detectRecurring`. That detector requires IDENTICAL amounts for income
 * (at most two plateaus — one raise). Real paychecks drift by cents (a benefit
 * deduction rounding — an invented example: $2,401.17 / $2,401.18) and step
 * through transition amounts around a raise, so it detects no series at all for
 * an ordinary payroll (measured on the owner's production rows, read-only,
 * 2026-10-03). Pay is judged here on rhythm, with amount tolerance, by payer.
 *
 * EVERY CLOSE CALL ERRS LOW. Biweekly (26) needs more evidence than semimonthly
 * (24); the paycheck is the median of the last eight but never more than the
 * newest (inside the 2% band a raise reaches the figure late, a cut at once);
 * and a household the rule does not clearly understand keeps the old basis.
 *
 * Pure: integer cents in, integer cents out; no I/O; no `new Date()`.
 */
import { addMonthsClamped, daysBetween, isoDate, monthKey, type ISODate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { median } from '@/lib/stats';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { countsInFlows, type TxnLike } from '@/lib/engine/fi/insights';
import {
  isEarnedIncomeRow,
  isGenericIncomePayRow,
  isUntouchableIncomeRow,
} from '@/lib/engine/spending-plan/income-pattern';

export type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

/** Pay periods in a year — the multiplier that turns one paycheck into a yearly figure. */
export const PAY_PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

/** Nominal days between paychecks — the base of the gap and "still arriving" gates. */
const PERIOD_DAYS: Record<PayFrequency, number> = {
  weekly: 7,
  biweekly: 14,
  semimonthly: 15,
  monthly: 30,
};

/** Leaves whose deposits can be regular pay. `bonus` is deliberately absent:
 *  a bonus is the reader saying "this one is NOT my regular pay". */
const REGULAR_PAY_CATEGORY_IDS: ReadonlySet<string> = new Set(['paycheck', 'side-income']);

/** How many of the most recent paydays judge the RHYTHM. */
const RHYTHM_WINDOW = 10;
/** How many of the most recent paydays judge the paycheck and its LEVEL. */
const LEVEL_WINDOW = 8;
/** Fewest paydays that can show a rhythm: three paydays = two gaps. */
const MIN_DEPOSITS = 3;
/** Biweekly (26 a year) is the costlier reading of the two-week family, so it
 *  needs NINE paydays on the 14-day grid before it can be claimed. Calendar-dated
 *  twice-a-month payrolls (1st/15th, 15th/last) stop fitting the grid by chance at
 *  seven (critic cycle 3: 174 of 66,744 windows at six, none at seven), but
 *  weekday-anchored ones ("2nd and 4th Friday") fit eight-payday windows 1.76–1.92%
 *  of the time — and none at nine, ten or twelve (critic cycle 7, P2-2, brute
 *  force 2015–2040, every weekday and business-day shift). A true biweekly
 *  payroll reads 24 a year until its ninth payday — low, never high. */
const MIN_DEPOSITS_BIWEEKLY = 9;
/** Every biweekly payday must sit within this many days of an exact 14-day grid
 *  anchored on the newest one (a holiday moves a payday a day or two). */
const BIWEEKLY_GRID_TOLERANCE_DAYS = 2;
/** Every weekly payday must sit within ONE day of an exact 7-day grid anchored on
 *  the newest. Without it, pay on four fixed dates a month (1st/8th/15th/22nd —
 *  48 a year) or two earners interleaved under one generic payroll name read as
 *  weekly and counted 52 a year, +8.3% (critic cycle 8, P2-1, executed); both
 *  break a ±1 grid at every month boundary (±2 lets the four-dates payroll
 *  through). A true weekly payroll shifted a day by a holiday stays on it. */
const WEEKLY_GRID_TOLERANCE_DAYS = 1;
/** A payday is a date whose deposits from the payer total at least half its
 *  typical payday; its AMOUNT counts as a paycheck only up to 1.5× typical — a
 *  payday that also carried a bonus keeps the rhythm but not the figure. */
const AMOUNT_BAND_LOW = 0.5;
const AMOUNT_BAND_HIGH = 1.5;
/** A payroll is a steady payroll at all only when the paychecks judged agree
 *  within 25% (largest ÷ smallest, as whole percent so the boundary is exact
 *  integer math): variable hourly pay, or two earners sharing one payroll
 *  descriptor, is not a single paycheck to annualize. */
const MAX_AMOUNT_SPREAD_PCT = 125;
/** Condition 3: the last eight paychecks must agree within 2% to plan the month
 *  — wider, the pay CHANGED (a raise, a cut, a run of overtime) and the median
 *  plans it until the new level fills the window (critic cycle 6, P1-1: five
 *  overtime checks of eight annualized a paycheck that had already stepped back
 *  down). Cent drift and small deduction changes stay inside it. */
const MAX_LEVEL_SPREAD_PCT = 102;
/** Condition 2: paydays belong to one unbroken run while each gap is at most
 *  this many periods (the same tolerance the rhythm's gap test uses). */
const RUN_GAP_PERIODS = 1.5;
/** A steady payroll is still arriving until one period plus this many days past
 *  its newest payday (a holiday or weekend moves a deposit a few days). */
const STALE_GRACE_DAYS = 5;
/** The months the window reads — the plan's median window (L.22). */
const WINDOW_MONTHS = 3;
/** Condition 5: the rest of the household's pay may be at most this percent of
 *  the paychecks in a USUAL month for the paycheck to "clearly explain" it. */
const MAX_OTHER_SHARE_PCT = 10;
/** Paychecks in a usual month — the fewest a calendar month holds (critic cycle
 *  6, P3-1: the yearly-rate figure counts 2.17 biweekly paychecks a month). */
const USUAL_PAYCHECKS_PER_MONTH: Record<PayFrequency, number> = {
  weekly: 4,
  biweekly: 2,
  semimonthly: 2,
  monthly: 1,
};

/**
 * The frequency a run of payday dates shows, or null when there is none.
 *
 *   1. Mean interval over the span: 5–9 days weekly (only with every payday
 *      within a day of an exact 7-day grid — else no rhythm); 12.5–16.5 the
 *      two-week family; 26–35 monthly.
 *   2. In the two-week family, BIWEEKLY only with ≥ 9 paydays that ALL sit within
 *      2 days of an exact 14-day grid anchored on the newest; otherwise
 *      SEMIMONTHLY. The mean interval alone cannot tell them apart (weekend
 *      shifts put a 1st/15th payroll at 14.57 days — critic cycle 1), nor can the
 *      weekday (cycle 2: six of eight paydays on a Friday); twice-a-month pay fits
 *      the grid by chance at six paydays (cycle 3) and, when anchored on weekdays,
 *      at eight (cycle 7) — in those brute forces, never at nine.
 *   3. Every gap must lie within [0.5×, 1.5×] of the chosen period.
 */
export function payFrequencyFromDates(dates: readonly ISODate[]): PayFrequency | null {
  if (dates.length < MIN_DEPOSITS) return null;
  const sorted = [...dates].sort();
  const span = daysBetween(sorted[0]!, sorted[sorted.length - 1]!);
  const mean = span / (sorted.length - 1);
  const newest = sorted[sorted.length - 1]!;
  const onGrid = (step: number, tolerance: number) =>
    sorted.every((d) => {
      const r = daysBetween(d, newest) % step;
      return Math.min(r, step - r) <= tolerance;
    });
  let frequency: PayFrequency | null = null;
  if (mean >= 5 && mean <= 9) {
    if (!onGrid(7, WEEKLY_GRID_TOLERANCE_DAYS)) return null;
    frequency = 'weekly';
  } else if (mean >= 12.5 && mean <= 16.5) {
    frequency =
      sorted.length >= MIN_DEPOSITS_BIWEEKLY && onGrid(14, BIWEEKLY_GRID_TOLERANCE_DAYS) ? 'biweekly' : 'semimonthly';
  } else if (mean >= 26 && mean <= 35) frequency = 'monthly';
  if (frequency === null) return null;
  const period = PERIOD_DAYS[frequency];
  for (let i = 1; i < sorted.length; i++) {
    const gap = daysBetween(sorted[i - 1]!, sorted[i]!);
    if (gap < period * 0.5 || gap > period * 1.5) return null;
  }
  return frequency;
}

export interface RegularPayStream {
  /** The payer, as the merchant normalizer names it. */
  payerCanonical: string;
  frequency: PayFrequency;
  /** The current paycheck: the median of the last eight paychecks, never more
   *  than the newest. */
  paycheckCents: number;
  /** `paycheckCents × periods-per-year ÷ 12`, Math.round (half-up). */
  monthlyCents: number;
  /** The first payday of the current UNBROKEN run (every gap ≤ 1.5 periods) —
   *  a payroll that paused and restarted is counted from the restart. */
  firstPaidOn: ISODate;
  /** The newest payday. */
  lastPaidOn: ISODate;
}

/** Why a household still keeps the median (diagnostic; the first that failed). */
export type RegularPayFallback =
  | 'no-steady-paycheck'
  | 'second-paycheck'
  | 'new-paycheck'
  | 'pay-changed'
  | 'paycheck-stopped'
  | 'other-income';

export interface RegularPay {
  /** True when one steady paycheck clearly explains the household's recent pay
   *  — the ONLY case the plan uses this figure. */
  clean: boolean;
  /** When not clean, the first condition that failed. */
  fallback: RegularPayFallback | null;
  /** Steady paychecks still arriving, largest first (also when not clean —
   *  a clean household has exactly one). */
  streams: RegularPayStream[];
  streamsMonthlyCents: number;
  /** The usual month of everything else counted as pay — median of the three
   *  complete months of the window; never a Bonus. */
  otherMonthlyCents: number;
  /** The income figure: the paycheck + other when clean; 0 otherwise. */
  monthlyCents: number;
}

/** The last `n` complete calendar-month keys before `today`, oldest first. */
function lastCompleteMonths(today: ISODate, n: number): string[] {
  const start = isoDate(`${monthKey(today)}-01`);
  const keys: string[] = [];
  for (let k = n; k >= 1; k--) keys.push(monthKey(addMonthsClamped(start, -k)));
  return keys;
}

/** A pay row the old median's earned path counts, never a Bonus. */
function isPayRow(t: TxnLike): boolean {
  return (isEarnedIncomeRow(t) || isGenericIncomePayRow(t)) && t.categoryId !== 'bonus';
}

/**
 * Regular pay from the reader's income-account rows (the same rows, through the
 * same reconciliation boundary, the median basis reads).
 *
 * Per payer (merchant canonical) with a row filed Paycheck or Side income, its
 * pay rows (Paycheck / Side income / generic Income, never untouchable, never a
 * Bonus) are summed PER DATE — two deposits on one payday are one payday. A
 * payday is a date totalling ≥ 0.5× the payer's typical (median) payday; the last
 * ten paydays must show a rhythm; the paychecks among the last eight (≤ 1.5×
 * typical) must agree within 25% to be a steady payroll at all, and within 2% to
 * plan the month; the paycheck is their median, never more than the newest.
 * Still arriving = newest payday within one period + 5 days.
 */
export function regularPayFromRows(transactions: readonly TxnLike[], today: ISODate): RegularPay {
  const byPayer = new Map<string, { hasRegularLeaf: boolean; byDate: Map<string, number> }>();
  for (const t of transactions) {
    if (t.amountCents <= 0 || !countsInFlows(t)) continue;
    const id = t.categoryId ?? null;
    const regularLeaf = id !== null && REGULAR_PAY_CATEGORY_IDS.has(id);
    const genericPay = id === 'income' && !isUntouchableIncomeRow(t);
    if (!regularLeaf && !genericPay) continue;
    const canon = normalizeMerchant(t.rawDescriptor).canonical;
    const slot = byPayer.get(canon) ?? { hasRegularLeaf: false, byDate: new Map<string, number>() };
    if (regularLeaf) slot.hasRegularLeaf = true;
    slot.byDate.set(t.date, (slot.byDate.get(t.date) ?? 0) + t.amountCents);
    byPayer.set(canon, slot);
  }

  const candidates: (RegularPayStream & { stale: boolean; levelHeld: boolean; paycheckDates: Set<string> })[] = [];
  for (const [payerCanonical, { hasRegularLeaf, byDate }] of byPayer) {
    if (!hasRegularLeaf) continue;
    const days = [...byDate.entries()]
      .map(([date, total]) => ({ date: date as ISODate, total }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const typical = median(days.map((d) => d.total));
    // The rhythm: first from every payday — so a payday that also carried a
    // bonus keeps its place (critic cycle 5, P2-B) — and, failing that, from the
    // paydays of ordinary size, so a bonus paid through payroll on its own
    // off-cycle date does not break it.
    const allPaydays = days.filter((d) => d.total >= typical * AMOUNT_BAND_LOW);
    const ordinaryPaydays = allPaydays.filter((d) => d.total <= typical * AMOUNT_BAND_HIGH);
    let paydays = allPaydays;
    let frequency = payFrequencyFromDates(paydays.slice(-RHYTHM_WINDOW).map((d) => d.date));
    if (frequency === null) {
      paydays = ordinaryPaydays;
      frequency = payFrequencyFromDates(paydays.slice(-RHYTHM_WINDOW).map((d) => d.date));
    }
    if (frequency === null) continue;
    const recent = paydays.slice(-LEVEL_WINDOW);
    const paychecks = recent.filter((d) => d.total <= typical * AMOUNT_BAND_HIGH);
    if (paychecks.length < MIN_DEPOSITS) continue;
    const amounts = paychecks.map((d) => d.total);
    const largest = Math.max(...amounts);
    const smallest = Math.min(...amounts);
    if (largest * 100 > smallest * MAX_AMOUNT_SPREAD_PCT) continue;
    // Never more than the newest paycheck: inside the 2% band a cut reaches the
    // figure at once and a raise only once most of the eight show it.
    const paycheckCents = Math.round(Math.min(median(amounts), amounts[amounts.length - 1]!));
    // The current unbroken run: walk back from the newest payday while each gap
    // is a pay period's (critic cycle 6, P2-1: a seasonal job that restarted
    // inside the window was "paying since" its first-ever payday).
    let runStart = paydays.length - 1;
    while (
      runStart > 0 &&
      daysBetween(paydays[runStart - 1]!.date, paydays[runStart]!.date) <= PERIOD_DAYS[frequency] * RUN_GAP_PERIODS
    ) {
      runStart--;
    }
    const last = recent[recent.length - 1]!;
    const period = PERIOD_DAYS[frequency];
    // Condition 3's two edges the 2% test cannot see (critic cycle 7, P1-1 D and
    // P2-1; cycle 8, P3-1): the NEWEST payday above the band (a raise past 1.5×,
    // or a bonus on this payday — the median plans it until the next ordinary
    // paycheck), and ANY deposit from the payroll after its newest payday that is
    // not itself a payday (a cut below half the usual paycheck, on the due date or
    // off-cycle like a partial final check, which would otherwise keep the old
    // level until the payroll went stale). Both fail closed until the next
    // ordinary payday.
    const newestDeposit = days[days.length - 1]!;
    const newestIsPaycheck = last.total <= typical * AMOUNT_BAND_HIGH;
    const depositSince = newestDeposit.date > last.date;
    candidates.push({
      payerCanonical,
      frequency,
      paycheckCents,
      monthlyCents: Math.round((paycheckCents * PAY_PERIODS_PER_YEAR[frequency]) / 12),
      firstPaidOn: paydays[runStart]!.date,
      lastPaidOn: last.date,
      stale: daysBetween(last.date, today) > period + STALE_GRACE_DAYS,
      levelHeld: largest * 100 <= smallest * MAX_LEVEL_SPREAD_PCT && newestIsPaycheck && !depositSince,
      // The paychecks this payer's figure stands for — every in-band payday, so
      // the remainder of its money (a bonus-sized payday, a stray small row) is
      // weighed as "other" in condition 5.
      paycheckDates: new Set(ordinaryPaydays.map((d) => d.date as string)),
    });
  }

  const live = candidates.filter((c) => !c.stale);
  const streams: RegularPayStream[] = live
    .map((c) => ({
      payerCanonical: c.payerCanonical,
      frequency: c.frequency,
      paycheckCents: c.paycheckCents,
      monthlyCents: c.monthlyCents,
      firstPaidOn: c.firstPaidOn,
      lastPaidOn: c.lastPaidOn,
    }))
    .sort((a, b) => b.monthlyCents - a.monthlyCents || a.payerCanonical.localeCompare(b.payerCanonical));
  const streamsMonthlyCents = streams.reduce((s, x) => s + x.monthlyCents, 0);

  // Everything else counted as pay, per complete month of the window: every pay
  // row EXCEPT a live stream's in-band paycheck days.
  const months = lastCompleteMonths(today, WINDOW_MONTHS);
  const windowStart = `${months[0]}-01`;
  const monthSet = new Set(months);
  const paycheckDatesByPayer = new Map(live.map((c) => [c.payerCanonical, c.paycheckDates]));
  const otherByMonth = new Map<string, number>(months.map((m) => [m, 0]));
  for (const t of transactions) {
    if (!isPayRow(t)) continue;
    const m = monthKey(t.date);
    if (!monthSet.has(m)) continue;
    const dates = paycheckDatesByPayer.get(normalizeMerchant(t.rawDescriptor).canonical);
    if (dates?.has(t.date)) continue;
    otherByMonth.set(m, (otherByMonth.get(m) ?? 0) + t.amountCents);
  }
  const otherMonthlyCents = Math.round(median(months.map((m) => otherByMonth.get(m) ?? 0)));
  const usualMonthCents = streams.reduce((s, x) => s + x.paycheckCents * USUAL_PAYCHECKS_PER_MONTH[x.frequency], 0);

  const fallback: RegularPayFallback | null =
    streams.length === 0
      ? 'no-steady-paycheck'
      : streams.length > 1
        ? 'second-paycheck'
        : streams[0]!.firstPaidOn >= windowStart
          ? 'new-paycheck'
          : !live[0]!.levelHeld
            ? 'pay-changed'
            : candidates.some((c) => c.stale && c.lastPaidOn >= windowStart)
              ? 'paycheck-stopped'
              : otherMonthlyCents * 100 > usualMonthCents * MAX_OTHER_SHARE_PCT
                ? 'other-income'
                : null;
  const clean = fallback === null;
  return {
    clean,
    fallback,
    streams,
    streamsMonthlyCents,
    otherMonthlyCents,
    monthlyCents: clean ? streamsMonthlyCents + otherMonthlyCents : 0,
  };
}

/** How each rhythm is said to a reader. */
const FREQUENCY_WORDS: Record<PayFrequency, string> = {
  weekly: 'every week',
  biweekly: 'every two weeks',
  semimonthly: 'about twice a month',
  monthly: 'every month',
};

/**
 * The ONE sentence every surface uses to explain a regular-pay income figure —
 * the glass box and Ask (one author; the L.23 lesson that two surfaces describing
 * one fact drift). It shows the arithmetic, says how the money really lands (two
 * biweekly paychecks in most months — a cash-timing fact the average hides),
 * states what is left out, and states the rule under which the figure applies in
 * the code's own terms — never a promise the code does not keep (critic cycles
 * 6 and 7). Only ever called for a CLEAN plan (exactly one stream).
 */
export function regularPayBasisSentence(pay: RegularPay): string {
  const parts = pay.streams.map((s) =>
    s.frequency === 'monthly'
      ? `${formatCents(cents(s.paycheckCents))} every month`
      : `${formatCents(cents(s.paycheckCents))} ${FREQUENCY_WORDS[s.frequency]} × ${PAY_PERIODS_PER_YEAR[s.frequency]} ÷ 12 (${formatCents(cents(s.monthlyCents))} a month)`,
  );
  const other =
    pay.otherMonthlyCents > 0
      ? ` plus ${formatCents(cents(pay.otherMonthlyCents))}, the usual month of your other income (the median of your last ${WINDOW_MONTHS} complete months)`
      : '';
  // "Paid all year": a school-year payroll (22 paydays) does not land three times
  // in two months, and the figure counts 26 (critic cycle 8, P3-2) — the timing
  // fact is stated as the condition it depends on.
  const timing = pay.streams.some((s) => s.frequency === 'biweekly')
    ? ' Paid every two weeks all year, a paycheck lands twice in most months and three times in two months — this figure spreads the year’s pay evenly, so most months bring a little less than it.'
    : pay.streams.some((s) => s.frequency === 'weekly')
      ? ' Paid every week all year, a paycheck lands four times in most months and five times in four months — this figure spreads the year’s pay evenly, so most months bring a little less than it.'
      : '';
  // The 24-a-year reading is also how an every-two-weeks payroll whose dates do
  // not sit cleanly on a 14-day grid is counted (critic cycle 4, P2-2; cycle 5,
  // P3-4): say the count, and why, rather than assert the reader's rhythm.
  const semimonthlyNote = pay.streams.some((s) => s.frequency === 'semimonthly')
    ? ' Pay counted 24 times a year is pay about twice a month — or pay every two weeks whose dates do not yet confirm it, counted the lower way.'
    : '';
  return `Income is your regular pay at its yearly rate: ${parts.join(' plus ')}${other} = ${formatCents(cents(pay.monthlyCents))} a month.${timing}${semimonthlyNote} Only deposits filed Paycheck, Side Gig / Freelance or Income count here; a bonus, every other income category (Investment Income, Interest Income, Rental Income, Retirement Income and the rest) and money moved in from your other accounts are left out. This figure is used only while one steady paycheck explains your pay: paid without a break since before your last three complete months, within 2% across its last eight paychecks, no other regular paycheck in that time, and the rest of those deposits no more than a tenth of a usual month’s pay. Otherwise the plan uses the median of your last three complete months. Within that 2%, a raise counts here once most of your last eight paychecks show it; a cut counts at once.`;
}
