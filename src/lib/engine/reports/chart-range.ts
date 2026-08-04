/**
 * The income-vs-spending chart's trailing-window vocabulary (owner request
 * 2026-08-04: "why are we only pulling 6 months of data? … need a way to view
 * last month, last quarter, last year").
 *
 * Lives in the engine — NOT in src/server/reports.ts — because BOTH the server
 * assembler (which slices the series) and the client view (which renders the
 * selector) must read the SAME vocabulary, and a client component importing a
 * src/server module drags the DB stack into the browser bundle. Same pattern
 * as the register's `?type=` vocabulary in engine/transactions/links.ts: one
 * author for the page that reads `?months=` and the view that draws the pick.
 */
export const REPORT_CHART_MONTHS = [6, 12, 24] as const;
export type ReportChartMonths = (typeof REPORT_CHART_MONTHS)[number];
