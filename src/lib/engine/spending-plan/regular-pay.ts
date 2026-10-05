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
 *   3. it has held one level — its last eight paychecks agree within 2% — or
 *      changed level ONCE (DECISIONS #786): in date order they split into an
 *      earlier and a later run that each agree within 2% and do not overlap,
 *      and the LOWER run and the LATER run each hold at least two paychecks;
 *      then the lower level is the paycheck (every week or two weeks, held to
 *      a usual month of the new pay — below). Pay that moved twice (overtime
 *      that started and stopped) is a change. The newest payday must be an
 *      ordinary paycheck, and no smaller deposit from the payroll may have
 *      arrived since;
 *   4. no other steady payroll stopped inside the window (no job just ended);
 *   5. everything else counted as pay — other payers, and the payroll's own
 *      unusual deposits — is no more than 10% of a usual month's paychecks (two
 *      every-two-weeks or twice-a-month paychecks, four weekly, one monthly).
 * Then income = the paycheck at its yearly rate (after one change, every week or
 * two weeks: never more than a usual month of the new pay) + that small usual
 * remainder. Every other household — a second paycheck, a job change to a new payer, pay
 * that moved more than once, a pension or a spouse's salary filed Income, a side
 * gig, seasonal or varying hourly pay — keeps the median EXACTLY as before. (Pay
 * that sits at two levels in two blocks — hourly pay that changed once, or a new
 * job paid under the same payroll name — reads as one change since #786, at the
 * lower level.)
 *
 * WHY THE LOWER LEVEL (owner, DECISIONS #786, 2026-10-05). A high earner's net
 * pay steps UP once the year's pay passes the Social Security wage base and back
 * down in January; under "one level" alone that held the owner's household on
 * the median for about half of every year. A step up is a raise, a run of
 * overtime, or a tax that stops being withheld for the rest of the year — and
 * the rows cannot tell them apart (critic cycle 6, P1-1). The lower level is
 * right or low in every one of those readings, and a step down is the newer pay
 * whichever it was: the earlier level for a rise from its second higher paycheck
 * while at least two of the eight are still at it, the newer level for a fall
 * from its second paycheck. A single paycheck is not a level, and a single new
 * payday cannot show its rhythm (a monthly job's first payday sits on a two-week
 * grid — cycle 3, P2-1), so both runs need two; in between (one risen, seven of
 * eight risen, or one fallen) the plan is on the median, as before — which can
 * sit above the lower level (#786 cycle 1, P2-2, recorded for the owner).
 *
 * AND NEVER MORE THAN A USUAL MONTH OF THE NEW PAY (#786 cycle 2, P1-A). A
 * change can also be a new job under the same payroll name that pays twice a
 * month (24 a year) where the old one paid every two weeks (26) — or four
 * fixed dates a month where the old one paid weekly. Its dates fit the old
 * rhythm for months (a brute force fits six twice-a-month paydays to a 14-day
 * grid, eight four-dates paydays to a 7-day one), so the rhythm cannot rule it
 * out. After one change, a weekly or biweekly figure is therefore held to a
 * usual month (four or two) of the smallest paycheck since the change — what
 * such a job would bring — which a true every-two-weeks rise above 8.33% (the
 * usual Social Security step) never reaches, and a fall always does. A new job
 * paid LESS often (monthly, every four weeks; every two weeks behind a weekly
 * reading) breaks the rhythm's gap test at its second payday, which the later
 * run must hold (cycle 3, P2-1). Not covered: every three weeks behind a
 * two-week reading reads twice a month (24, uncapped) — recorded (cycle 3, P3-6).
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
 * (24); the paycheck is the median of the last eight — or of the lower run —
 * but never more than the newest (inside the 2% band a raise reaches the figure
 * late, a cut at once; past it, a rise only once all eight show it, a fall from
 * its second paycheck); and a household the rule does not clearly understand
 * keeps the old basis.
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
/** Condition 3's one-change reading: the run the figure counts, and the newer
 *  run, each need at least this many paychecks — one paycheck is not a level,
 *  and one new payday cannot show its rhythm (DECISIONS #786). */
const MIN_RUN = 2;
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

/** How the last eight paychecks changed level, when they changed it once. */
export interface PayStep {
  /** `rose`: the figure counts the EARLIER, lower level; `fell`: the newer one. */
  direction: 'rose' | 'fell';
  /** The newest paycheck — what the reader saw land last. */
  newestCents: number;
  /** The smallest paycheck since the change. For pay every week or every two
   *  weeks the monthly figure is never more than a usual month of these (four
   *  or two): a change can be a new job paid four times or twice a month, and
   *  until eight paychecks agree its dates cannot tell it from the old rhythm
   *  (#786 critic cycle 2, P1-A; a brute force fits six twice-a-month paydays to
   *  a two-week grid, eight four-dates paydays to a weekly one). */
  sinceCents: number;
}

export interface RegularPayStream {
  /** The payer, as the merchant normalizer names it. */
  payerCanonical: string;
  frequency: PayFrequency;
  /** The current paycheck: the median of the last eight paychecks — or, when
   *  they changed level once, of the lower run — never more than the newest. */
  paycheckCents: number;
  /** Set when the last eight paychecks changed level once (DECISIONS #786);
   *  null when they held one level or moved more than once. */
  step: PayStep | null;
  /** `paycheckCents × periods-per-year ÷ 12`, Math.round (half-up) — after one
   *  change, for weekly or biweekly pay, never more than a usual month of the
   *  smallest paycheck since the change (`step.sinceCents` × 4 or × 2). */
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

/** Weekly and biweekly readings count more paychecks a year than a usual month
 *  holds (52 vs 4 × 12, 26 vs 2 × 12) — the only readings a change of rhythm
 *  can hide behind. Twice-a-month and monthly readings already count the low
 *  way. */
function capsAfterChange(frequency: PayFrequency): boolean {
  return frequency === 'weekly' || frequency === 'biweekly';
}

/** The stream's monthly figure: the paycheck at its yearly rate; after one
 *  change (`sinceCents` set) on a weekly or biweekly reading, never more than a
 *  usual month of the smallest paycheck since the change (#786 cycle 2, P1-A). */
function monthlyAfter(paycheckCents: number, frequency: PayFrequency, sinceCents: number | null): number {
  const yearly = Math.round((paycheckCents * PAY_PERIODS_PER_YEAR[frequency]) / 12);
  return sinceCents !== null && capsAfterChange(frequency)
    ? Math.min(yearly, USUAL_PAYCHECKS_PER_MONTH[frequency] * sinceCents)
    : yearly;
}

/** One level: the largest paycheck within 2% of the smallest (whole-number). */
function isOneLevel(amounts: readonly number[]): boolean {
  return Math.max(...amounts) * 100 <= Math.min(...amounts) * MAX_LEVEL_SPREAD_PCT;
}

/**
 * Condition 3's one-change reading (DECISIONS #786): the paychecks, in date
 * order, split into an earlier and a later run that are each one level and do
 * not overlap — every paycheck of the higher run above every paycheck of the
 * lower — and the LOWER and LATER runs each hold at least two. Returns the lower
 * run's paycheck (its median, rounded), which way the pay moved, and the
 * smallest paycheck after any qualifying split — or null. Every qualifying
 * split is tried: the lowest paycheck wins, and "since the change" is the
 * smallest paycheck after ANY of them, so neither figure depends on which split
 * a tie picks (#786 cycle 3, P2-3) and both err low. The LATER run must also
 * hold two paychecks: a single newest paycheck above the rest can be the first
 * payday of a job paid less often (monthly behind a two-week reading), which the
 * rhythm shows only at its second payday (cycle 3, P2-1).
 */
function changedOnce(
  amounts: readonly number[],
): { lowerCents: number; direction: PayStep['direction']; sinceCents: number } | null {
  let found: { lowerCents: number; direction: PayStep['direction'] } | null = null;
  let sinceCents = Infinity;
  for (let split = 1; split < amounts.length; split++) {
    const earlier = amounts.slice(0, split);
    const later = amounts.slice(split);
    if (!isOneLevel(earlier) || !isOneLevel(later)) continue;
    const rose = Math.min(...later) > Math.max(...earlier);
    if (!rose && !(Math.min(...earlier) > Math.max(...later))) continue;
    const lower = rose ? earlier : later;
    if (lower.length < MIN_RUN || later.length < MIN_RUN) continue;
    const lowerCents = Math.round(median(lower));
    sinceCents = Math.min(sinceCents, ...later);
    if (found === null || lowerCents < found.lowerCents) found = { lowerCents, direction: rose ? 'rose' : 'fell' };
  }
  return found === null ? null : { ...found, sinceCents };
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
 * typical) must agree within 25% to be a steady payroll at all, and within 2% —
 * or as two runs each within 2%, one change of level — to plan the month; the
 * paycheck is their median, or the lower run's, never more than the newest.
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
    // One level, or a single change of level counted at the lower run
    // (DECISIONS #786). Never more than the newest paycheck: inside the 2% band
    // a cut reaches the figure at once and a raise only once most of the eight
    // show it.
    const newestPaycheck = amounts[amounts.length - 1]!;
    const oneLevel = isOneLevel(amounts);
    const changed = oneLevel ? null : changedOnce(amounts);
    const paycheckCents = Math.round(Math.min(changed ? changed.lowerCents : median(amounts), newestPaycheck));
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
      step: changed
        ? { direction: changed.direction, newestCents: newestPaycheck, sinceCents: changed.sinceCents }
        : null,
      monthlyCents: monthlyAfter(paycheckCents, frequency, changed?.sinceCents ?? null),
      firstPaidOn: paydays[runStart]!.date,
      lastPaidOn: last.date,
      stale: daysBetween(last.date, today) > period + STALE_GRACE_DAYS,
      levelHeld: (oneLevel || changed !== null) && newestIsPaycheck && !depositSince,
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
      step: c.step,
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
  // DECISIONS #786: a weekly or biweekly reading whose pay changed once is held
  // to a usual month of the smallest paycheck since the change (cycle 2, P1-A).
  const capped = (s: RegularPayStream) => s.step !== null && capsAfterChange(s.frequency);
  const parts = pay.streams.map((s) => {
    if (s.frequency === 'monthly') return `${formatCents(cents(s.paycheckCents))} every month`;
    const periods = PAY_PERIODS_PER_YEAR[s.frequency];
    const rate = `${formatCents(cents(s.paycheckCents))} ${FREQUENCY_WORDS[s.frequency]} × ${periods} ÷ 12`;
    if (!capped(s)) return `${rate} (${formatCents(cents(s.monthlyCents))} a month)`;
    const usual = USUAL_PAYCHECKS_PER_MONTH[s.frequency];
    const since = s.step!.sinceCents;
    return `${rate} (${formatCents(cents(Math.round((s.paycheckCents * periods) / 12)))}) or ${usual === 4 ? 'four' : 'two'} paychecks a month at the smallest since the change (${formatCents(cents(since))} × ${usual} = ${formatCents(cents(since * usual))}), whichever is less (${formatCents(cents(s.monthlyCents))} a month)`;
  });
  const other =
    pay.otherMonthlyCents > 0
      ? ` plus ${formatCents(cents(pay.otherMonthlyCents))}, the usual month of your other income (the median of your last ${WINDOW_MONTHS} complete months)`
      : '';
  // Any change → "counted low", the same words the /budgets note uses (cycle 3,
  // P3-4); the arithmetic says which arm counts.
  const lead = pay.streams.some((s) => s.step !== null)
    ? 'Income is your regular pay, counted low after a change in pay'
    : 'Income is your regular pay at its yearly rate';
  // "Paid all year": a school-year payroll (22 paydays) does not land three times
  // in two months, and the figure counts 26 (critic cycle 8, P3-2) — the timing
  // fact is stated as the condition it depends on. Only for a stream at its
  // yearly rate: a capped stream's arithmetic already names a usual month, and
  // after a rise two paychecks at the newest amount can bring more than the
  // figure (#786 cycle 1, P1-1).
  const yearlyRate = pay.streams.filter((s) => !capped(s));
  const timing = yearlyRate.some((s) => s.frequency === 'biweekly')
    ? ' Paid every two weeks all year, a paycheck lands twice in most months and three times in two months — this figure spreads the year’s pay evenly, so most months bring a little less than it.'
    : yearlyRate.some((s) => s.frequency === 'weekly')
      ? ' Paid every week all year, a paycheck lands four times in most months and five times in four months — this figure spreads the year’s pay evenly, so most months bring a little less than it.'
      : '';
  // The 24-a-year reading is also how an every-two-weeks payroll whose dates do
  // not sit cleanly on a 14-day grid is counted (critic cycle 4, P2-2; cycle 5,
  // P3-4): say the count, and why, rather than assert the reader's rhythm.
  const semimonthlyNote = pay.streams.some((s) => s.frequency === 'semimonthly')
    ? ' Pay counted 24 times a year is pay about twice a month — or pay every two weeks whose dates do not yet confirm it, counted the lower way.'
    : '';
  // Say which paycheck the figure counts and why — the reader's newest paycheck
  // is not the one in the arithmetic after a rise. "Rose"/"fell", not "changed
  // level": the higher side may be a single paycheck (cycle 1, P3-1). No promise
  // about a later state — the next one may be the median (cycle 1, P2-2).
  const stepped = pay.streams.find((s) => s.step !== null);
  let stepNote = '';
  if (stepped) {
    const step = stepped.step!;
    const newest = formatCents(cents(step.newestCents));
    const why = stepped.frequency === 'weekly' ? 'pay every week from a new job paid four times a month' : 'pay every two weeks from a new job paid twice a month';
    const many = stepped.frequency === 'weekly' ? 'four' : 'two';
    // When capped, name BOTH arms — the figure may be the usual month of the new
    // pay, not the earlier paycheck (#786 cycle 3, P3-4).
    const reasons = 'the paychecks alone cannot tell a raise from overtime, or from Social Security tax that stops being withheld once the year’s pay passes its cap';
    stepNote =
      step.direction === 'rose'
        ? capped(stepped)
          ? ` Your pay rose within its last eight paychecks (your newest was ${newest}), so this counts the earlier, lower paycheck at its yearly rate, or ${many} paychecks a month at the new pay if that is less: ${reasons}, and until eight paychecks agree their dates cannot tell ${why}.`
          : ` Your pay rose within its last eight paychecks (your newest was ${newest}), so this counts the earlier, lower paycheck — ${reasons}.`
        : capped(stepped)
          ? ` Your pay fell within its last eight paychecks (your newest was ${newest}), so this counts the newer, lower paycheck at its yearly rate, or ${many} of them a month if that is less: until eight paychecks agree, their dates cannot tell ${why}.`
          : ` Your pay fell within its last eight paychecks (your newest was ${newest}), so this counts the newer, lower paycheck.`;
  }
  return `${lead}: ${parts.join(' plus ')}${other} = ${formatCents(cents(pay.monthlyCents))} a month.${stepNote}${timing}${semimonthlyNote} Only deposits filed Paycheck, Side Gig / Freelance or Income count here; a bonus, every other income category (Investment Income, Interest Income, Rental Income, Retirement Income and the rest) and money moved in from your other accounts are left out. This figure is used only while one steady paycheck explains your pay: paid without a break since before your last three complete months, its last eight paychecks within 2% of each other — or split once into an earlier and a later run, each within 2% and not overlapping, with at least two paychecks in each — no other regular paycheck in that time, and the rest of those deposits no more than a tenth of a usual month’s pay. Otherwise the plan uses the median of your last three complete months. Within that 2%, a raise counts here once most of your last eight paychecks show it; a cut counts at once. After a split, the lower run counts.`;
}
