/**
 * The Reports page's range vocabulary (owner request 2026-08-04: "why are we
 * only pulling 6 months of data? … need a way to view last month, last
 * quarter, last year"). Trailing 6 / 12 / 24 months, plus named calendar
 * years (DECISIONS #567).
 *
 * Lives in the engine — NOT in src/server/reports.ts — because BOTH the server
 * assembler (which slices the series) and the client view (which renders the
 * selector) must read the SAME vocabulary, and a client component importing a
 * src/server module drags the DB stack into the browser bundle. Same pattern
 * as the register's `?type=` vocabulary in engine/transactions/links.ts: one
 * author for the page that reads `?months=` / `?year=` and the view that draws
 * the pick.
 */
export const REPORT_CHART_MONTHS = [6, 12, 24] as const;
export type ReportChartMonths = (typeof REPORT_CHART_MONTHS)[number];

/**
 * Named calendar years on the Reports range picker: current year and the two
 * before it. Last 12 months stays a rolling window; a named year is Jan–Dec
 * of that civil year (clamped to today in the assembler).
 */
export function reportCalendarYears(today: string): number[] {
  const y = Number(today.slice(0, 4));
  if (!Number.isInteger(y) || y < 1000 || y > 9999) return [];
  return [y - 2, y - 1, y];
}

/** `?year=YYYY` if it is one of the named years for `today`, else null. */
export function parseReportYear(raw: string, today: string): number | null {
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return reportCalendarYears(today).includes(year) ? year : null;
}
