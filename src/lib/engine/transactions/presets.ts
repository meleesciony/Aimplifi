/**
 * Period presets for the register's date window — "last month", "last quarter",
 * "last year" and friends (owner request 2026-08-04: "still need a way to view
 * last month, last quarter, last year, etc.").
 *
 * Pure date math on calendar dates (CLAUDE.md rule 3): every window is computed
 * from an injected `today` via the shared utilities in lib/dates.ts — no
 * `new Date()` here, no timezone dependence, hand-verified expectations in
 * tests/unit/period-presets.test.ts and docs/EDGE_CASES.md.
 *
 * The register itself still windows by inclusive `from`/`to` query params
 * (engine/transactions/query.ts): a preset is nothing more than a named way to
 * PICK those two dates, so a preset-filtered register and a hand-typed register
 * filter with the same dates always show the same rows. `matchPeriodPreset`
 * runs the same windows in reverse so the dropdown can show what is active —
 * including "Custom" when the dates match no preset.
 */
import {
  type ISODate,
  addDays,
  addMonthsClamped,
  addMonthsToMonthKey,
  isoDate,
  monthKey,
  monthWindow,
  startOfMonth,
} from '@/lib/dates';

export const PERIOD_PRESETS = [
  'this-month',
  'last-month',
  'last-3-months',
  'last-quarter',
  'last-12-months',
  'ytd',
  'last-year',
  'all-time',
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

/** Dropdown labels, in the same order as PERIOD_PRESETS. */
export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-3-months': 'Past 3 months',
  'last-quarter': 'Last quarter',
  'last-12-months': 'Past 12 months',
  ytd: 'Year to date',
  'last-year': 'Last year',
  'all-time': 'All time',
};

export interface PeriodWindow {
  /** Inclusive first day of the window; null = no lower bound. */
  from: ISODate | null;
  /** Inclusive last day of the window; null = no upper bound. */
  to: ISODate | null;
}

/**
 * The inclusive from/to window a preset means AS OF `today`.
 *
 * Conventions, stated once because they are the whole semantics:
 *  - "Last month" / "Last quarter" / "Last year" are the COMPLETED calendar
 *    periods before the current one (July when it is August; Apr–Jun when it
 *    is Q3; 2025 during 2026). That is what the words mean in everyday use,
 *    and it is what makes them comparable month over month.
 *  - "Past N months" is a ROLLING window ending today: the N months up to and
 *    including today (from = today minus N months, plus one day).
 *  - "All time" sets no window at all — both bounds null.
 */
export function presetWindow(preset: PeriodPreset, today: ISODate): PeriodWindow {
  switch (preset) {
    case 'all-time':
      return { from: null, to: null };
    case 'this-month':
      return { from: startOfMonth(today), to: today };
    case 'last-month':
      return monthWindow(addMonthsToMonthKey(monthKey(today), -1));
    case 'last-3-months':
      return { from: addDays(addMonthsClamped(today, -3), 1), to: today };
    case 'last-quarter': {
      // First month of the CURRENT quarter (0-based offset from it), then the
      // three months before that quarter's start are the previous quarter —
      // via month-key arithmetic, so the year boundary (Jan–Mar → prior Oct–Dec)
      // falls out of addMonthsToMonthKey instead of a hand-rolled branch.
      const monthsIntoQuarter = (+today.slice(5, 7) - 1) % 3;
      const currentQuarterStart = addMonthsToMonthKey(monthKey(today), -monthsIntoQuarter);
      const lastQuarterStart = addMonthsToMonthKey(currentQuarterStart, -3);
      const lastQuarterEnd = addMonthsToMonthKey(currentQuarterStart, -1);
      return { from: monthWindow(lastQuarterStart).from, to: monthWindow(lastQuarterEnd).to };
    }
    case 'last-12-months':
      return { from: addDays(addMonthsClamped(today, -12), 1), to: today };
    case 'ytd':
      return { from: isoDate(`${today.slice(0, 4)}-01-01`), to: today };
    case 'last-year': {
      const y = +today.slice(0, 4) - 1;
      return { from: isoDate(`${y}-01-01`), to: isoDate(`${y}-12-31`) };
    }
  }
}

/**
 * Which preset (if any) a from/to pair IS, as of `today`. The dropdown shows
 * the matching preset; a window that matches none reads 'custom'; no window at
 * all reads 'all-time'. Reverse of presetWindow using the exact same windows,
 * so the control can never show a preset whose dates differ from the inputs'.
 */
export function matchPeriodPreset(
  from: string,
  to: string,
  today: ISODate,
): PeriodPreset | 'custom' {
  if (!from && !to) return 'all-time';
  for (const preset of PERIOD_PRESETS) {
    const w = presetWindow(preset, today);
    if ((w.from ?? '') === from && (w.to ?? '') === to) return preset;
  }
  return 'custom';
}
