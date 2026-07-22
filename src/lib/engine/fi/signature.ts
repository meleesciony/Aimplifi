/**
 * Money Signature (AI plan §Later #11, reworked per its adversarial verdict —
 * DECISIONS #252): two stable HABIT axes + one responsive "financial weather"
 * state, all derived deterministically from the monthly flow series. No LLM,
 * no persistence — hysteresis is a retrospective walk over history, so the
 * confirmed label at any point in time is a pure function of the flows.
 *
 * The rework this bakes in (the reason the original idea was needs-rework):
 *   • Discrete threshold cuts over continuous values oscillate on every
 *     recompute. Every axis label therefore passes through TWO dampers:
 *     a DEAD ZONE between the steady/variable bands (mid-band months produce
 *     no signal at all), and a PERSISTENCE gate (a confirmed label flips only
 *     after LABEL_PERSISTENCE_MONTHS consecutive months of the contrary
 *     banded signal; a no-signal month resets the run). Initialization is
 *     immediate on the first banded signal — persistence gates flips, not
 *     first light.
 *   • The WEATHER state is deliberately responsive (no hysteresis): it is
 *     framed as "this month", so a change is expected information, not an
 *     arbitrary identity flip. Stable axes and weather never share a label.
 *   • Habit framing, not personality: the engine emits facts (months saved,
 *     spread) alongside each label; copy renders the facts.
 *
 * Only FULL calendar months feed the engine — the month containing `today`
 * is dropped first, so a partial month can never move an axis or the weather.
 * Calendar gap months (no transactions → no MonthlyFlow row) are materialized
 * as { income 0, expenses 0, rate null }, matching detectLifestyleCreep's
 * zero-fill convention: invisible to the saving-habit axis (null rate), a
 * real $0 month to the steadiness axis.
 *
 * Median/MAD use the radar integer convention (engine/anomaly/detect.ts,
 * engine/merchant/profile.ts): sorted; odd n → middle element; even n →
 * floor of the mean of the two middles; MAD = median (same convention) of
 * absolute deviations from the median. Hand-verified: docs/EDGE_CASES.md
 * §Money Signature.
 */

import { cents } from '@/lib/money';
import { type ISODate, addMonthsToMonthKey, monthKey } from '@/lib/dates';
import { medianOfSorted } from '@/lib/stats';
import type { MonthlyFlow } from './insights';
import { computeSavingsStreak } from './savings-streak';

// ── Thresholds (each states its assumption where copy renders it) ───────────

/** Axis 1: saved in ≥ 75% of eligible trailing months → 'steady'. */
export const SAVING_STEADY_MIN_SHARE_BPS = 7500;
/** Axis 1: saved in ≤ 50% of eligible trailing months → 'variable'. */
export const SAVING_VARIABLE_MAX_SHARE_BPS = 5000;
/** Axis 1: months with a computable savings rate required before any signal. */
export const SAVING_MIN_ELIGIBLE_MONTHS = 6;
/** Axis 1: the trailing window is the most recent ≤ 12 eligible months. */
export const SAVING_WINDOW_MONTHS = 12;

/** Axis 2: trailing window is exactly the last 6 full calendar months. */
export const STEADINESS_WINDOW_MONTHS = 6;
/** Axis 2: MAD/median spread ≤ 10% → 'steady'. */
export const STEADINESS_STEADY_MAX_SPREAD_BPS = 1000;
/** Axis 2: MAD/median spread ≥ 25% → 'variable'. */
export const STEADINESS_VARIABLE_MIN_SPREAD_BPS = 2500;

/** A confirmed label flips only after this many CONSECUTIVE contrary raws. */
export const LABEL_PERSISTENCE_MONTHS = 3;

/** Weather: runway strictly below this many months → 'strained'. */
export const WEATHER_STRAINED_RUNWAY_MONTHS = 1;
/** Weather: runway strictly below this (or a negative latest month) → 'tight'. */
export const WEATHER_TIGHT_RUNWAY_MONTHS = 3;

export type AxisLabel = 'steady' | 'variable';
export type WeatherState = 'strained' | 'tight' | 'calm' | 'bright';

export interface SavingHabitAxis {
  /** null = forming (fewer than SAVING_MIN_ELIGIBLE_MONTHS eligible months). */
  label: AxisLabel | null;
  /** YYYY-MM the current label was established (init or last flip). */
  sinceMonth: string | null;
  /** Latest-window facts, for facts-first copy. */
  savedMonths: number;
  eligibleMonths: number;
  /** floor(saved × 10000 / eligible) for the latest window; null while forming. */
  shareBps: number | null;
  /**
   * True when the LATEST month's banded raw signal is the opposite label of
   * the confirmed (hysteresis-lagged) one — i.e. a contrary run is underway
   * but hasn't persisted long enough to flip. Copy MUST branch on this:
   * rendering the unqualified label while its own inline facts contradict it
   * is a false claim (#252 critic P1-1).
   */
  latestContrary: boolean;
}

export interface SpendingSteadinessAxis {
  label: AxisLabel | null;
  sinceMonth: string | null;
  /** floor(MAD × 10000 / median) for the latest 6-month window; null if the
   *  window is short or its median is 0. */
  spreadBps: number | null;
  /** See SavingHabitAxis.latestContrary (#252 critic P1-1). */
  latestContrary: boolean;
  /**
   * True when ≥ STEADINESS_WINDOW_MONTHS full months exist at all — lets the
   * UI distinguish "not enough history yet" from "the recent window has no
   * readable spending" when spreadBps is null (#252 critic P2-1).
   */
  hasFullWindow: boolean;
}

export interface MoneySignature {
  savingHabit: SavingHabitAxis;
  spendingSteadiness: SpendingSteadinessAxis;
  weather: {
    state: WeatherState;
    /** The latest FULL month the weather was read on; null with no history. */
    latestMonth: string | null;
    latestRateBps: number | null;
    runwayMonths: number;
  };
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Radar integer median convention (see module doc): the shared exact median,
 *  floored to whole cents here — the rounding is this engine's decision, not the
 *  utility's (src/lib/stats.ts). */
function medianCents(sorted: readonly number[]): number {
  return Math.floor(medianOfSorted(sorted));
}

/**
 * The hysteresis walk (EDGE_CASES §Money Signature H1–H5). Raw labels are the
 * per-month banded signals; null = no signal (dead zone, short window, no
 * income). The first non-null raw initializes the label immediately; after
 * that, the label flips only when LABEL_PERSISTENCE_MONTHS CONSECUTIVE raws
 * carry the same contrary label — any null or same-label raw resets the run.
 */
export function resolveConfirmedLabel(raws: readonly (AxisLabel | null)[]): {
  label: AxisLabel | null;
  sinceIndex: number | null;
} {
  let label: AxisLabel | null = null;
  let sinceIndex: number | null = null;
  let contraryRun = 0;
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i]!;
    if (raw === null) {
      contraryRun = 0;
      continue;
    }
    if (label === null) {
      label = raw;
      sinceIndex = i;
      contraryRun = 0;
      continue;
    }
    if (raw === label) {
      contraryRun = 0;
      continue;
    }
    contraryRun += 1;
    if (contraryRun >= LABEL_PERSISTENCE_MONTHS) {
      label = raw;
      sinceIndex = i;
      contraryRun = 0;
    }
  }
  return { label, sinceIndex };
}

/** Month key arithmetic via the tested date utilities (no ad-hoc Date math). */
function nextMonth(month: string): string {
  return addMonthsToMonthKey(month, 1);
}

interface FullMonth {
  month: string;
  incomeCents: number;
  expensesCents: number;
  savingsRateBps: number | null;
}

/**
 * Drop the partial current month, sort ascending, and materialize calendar
 * gap months as { expenses 0, rate null } — creep's zero-fill convention,
 * anchored like creep's grid to the month BEFORE `today` (#252 critic P2-2):
 * trailing gap months are real completed $0 months, so "this month's weather"
 * always reads the true latest full calendar month, never a stale one.
 */
function fullCalendarMonths(flows: readonly MonthlyFlow[], today: ISODate): FullMonth[] {
  const currentYm = monthKey(today);
  const kept = flows
    .filter((f) => f.month < currentYm)
    .slice()
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  if (kept.length === 0) return [];
  const lastFullYm = addMonthsToMonthKey(currentYm, -1);
  const byMonth = new Map(kept.map((f) => [f.month, f]));
  const out: FullMonth[] = [];
  for (let m = kept[0]!.month; m <= lastFullYm; m = nextMonth(m)) {
    const f = byMonth.get(m);
    out.push({
      month: m,
      incomeCents: f?.incomeCents ?? 0,
      expensesCents: f?.expensesCents ?? 0,
      savingsRateBps: f?.savingsRateBps ?? null,
    });
  }
  return out;
}

// ── Axis raw-signal series ──────────────────────────────────────────────────

function savingHabitRaws(months: readonly FullMonth[]): {
  raws: (AxisLabel | null)[];
  latest: { savedMonths: number; eligibleMonths: number; shareBps: number | null };
} {
  const raws: (AxisLabel | null)[] = [];
  let latest = { savedMonths: 0, eligibleMonths: 0, shareBps: null as number | null };
  // Eligible months so far, in order (rate ≠ null); the window is the last ≤ 12.
  const eligible: number[] = []; // savingsRateBps values
  for (const m of months) {
    if (m.savingsRateBps !== null) eligible.push(m.savingsRateBps);
    const window = eligible.slice(-SAVING_WINDOW_MONTHS);
    if (window.length < SAVING_MIN_ELIGIBLE_MONTHS) {
      raws.push(null);
      latest = { savedMonths: window.filter((r) => r >= 0).length, eligibleMonths: window.length, shareBps: null };
      continue;
    }
    const saved = window.filter((r) => r >= 0).length;
    const shareBps = Math.floor((saved * 10000) / window.length);
    latest = { savedMonths: saved, eligibleMonths: window.length, shareBps };
    if (shareBps >= SAVING_STEADY_MIN_SHARE_BPS) raws.push('steady');
    else if (shareBps <= SAVING_VARIABLE_MAX_SHARE_BPS) raws.push('variable');
    else raws.push(null);
  }
  return { raws, latest };
}

function steadinessRaws(months: readonly FullMonth[]): {
  raws: (AxisLabel | null)[];
  latestSpreadBps: number | null;
} {
  const raws: (AxisLabel | null)[] = [];
  let latestSpreadBps: number | null = null;
  for (let i = 0; i < months.length; i++) {
    if (i < STEADINESS_WINDOW_MONTHS - 1) {
      raws.push(null);
      latestSpreadBps = null;
      continue;
    }
    const window = months.slice(i - STEADINESS_WINDOW_MONTHS + 1, i + 1).map((m) => m.expensesCents);
    const sorted = [...window].sort((a, b) => a - b);
    const med = medianCents(sorted);
    if (med <= 0) {
      raws.push(null);
      latestSpreadBps = null;
      continue;
    }
    const devs = window.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
    const mad = medianCents(devs);
    const spreadBps = Math.floor((mad * 10000) / med);
    latestSpreadBps = spreadBps;
    if (spreadBps <= STEADINESS_STEADY_MAX_SPREAD_BPS) raws.push('steady');
    else if (spreadBps >= STEADINESS_VARIABLE_MIN_SPREAD_BPS) raws.push('variable');
    else raws.push(null);
  }
  return { raws, latestSpreadBps };
}

// ── The signature ───────────────────────────────────────────────────────────

export function computeMoneySignature(
  flows: readonly MonthlyFlow[],
  opts: { runwayMonths: number; today: ISODate },
): MoneySignature {
  const months = fullCalendarMonths(flows, opts.today);

  const habit = savingHabitRaws(months);
  const habitLabel = resolveConfirmedLabel(habit.raws);

  const steadiness = steadinessRaws(months);
  const steadinessLabel = resolveConfirmedLabel(steadiness.raws);

  const latest = months.length ? months[months.length - 1]! : null;
  const latestRateBps = latest?.savingsRateBps ?? null;
  const eligibleCount = months.filter((m) => m.savingsRateBps !== null).length;

  // Personal best via the streak engine (reused, never re-derived). It reads
  // the full-months series only — the same universe as everything above.
  const streak = computeSavingsStreak(
    months.map((m) => ({
      month: m.month,
      incomeCents: cents(m.incomeCents),
      expensesCents: cents(m.expensesCents),
      savingsRateBps: m.savingsRateBps,
    })),
  );

  const { runwayMonths } = opts;
  let state: WeatherState;
  if (runwayMonths < WEATHER_STRAINED_RUNWAY_MONTHS) state = 'strained';
  else if (runwayMonths < WEATHER_TIGHT_RUNWAY_MONTHS || (latestRateBps !== null && latestRateBps < 0)) {
    state = 'tight';
  } else if (
    streak.isPersonalBest &&
    latestRateBps !== null &&
    latestRateBps >= 0 &&
    eligibleCount >= SAVING_MIN_ELIGIBLE_MONTHS
  ) {
    state = 'bright';
  } else state = 'calm';

  const lastHabitRaw = habit.raws.length ? habit.raws[habit.raws.length - 1]! : null;
  const lastSteadinessRaw = steadiness.raws.length ? steadiness.raws[steadiness.raws.length - 1]! : null;

  return {
    savingHabit: {
      label: habitLabel.label,
      sinceMonth: habitLabel.sinceIndex === null ? null : months[habitLabel.sinceIndex]!.month,
      savedMonths: habit.latest.savedMonths,
      eligibleMonths: habit.latest.eligibleMonths,
      shareBps: habit.latest.shareBps,
      latestContrary:
        habitLabel.label !== null && lastHabitRaw !== null && lastHabitRaw !== habitLabel.label,
    },
    spendingSteadiness: {
      label: steadinessLabel.label,
      sinceMonth: steadinessLabel.sinceIndex === null ? null : months[steadinessLabel.sinceIndex]!.month,
      spreadBps: steadiness.latestSpreadBps,
      latestContrary:
        steadinessLabel.label !== null &&
        lastSteadinessRaw !== null &&
        lastSteadinessRaw !== steadinessLabel.label,
      hasFullWindow: months.length >= STEADINESS_WINDOW_MONTHS,
    },
    weather: {
      state,
      latestMonth: latest?.month ?? null,
      latestRateBps,
      runwayMonths,
    },
  };
}
