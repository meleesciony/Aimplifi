/**
 * chart-colors.ts — THE chart color tokens (single source of truth).
 *
 * Every Recharts/SVG chart surface takes its colors from here; no chart hex
 * literals at call sites. Before this module, /reports cycled a 400-series
 * palette (income #34d399, spend #fb7185) while the allocation drilldown,
 * forecast, and net-worth line used 500-series hues (#10b981 / #f43f5e) —
 * the same semantic ("money in" / "money out") rendered two different colors
 * depending on the page. Values are Tailwind 500-series hues anchored on the
 * brand-500 hex (#10b981, which is also the PWA themeColor in app/layout.tsx).
 *
 * These are decorative fills/strokes, not text — WCAG text-contrast rules
 * (axe gate) do not apply to them; every chart also carries text labels.
 */

/** Brand / positive — money in, growth, on-track. (theme brand-500 / positive-500.) */
export const CHART_POSITIVE = '#10b981';

/** Money out, dips, shortfall. (Tailwind rose-500.) */
export const CHART_NEGATIVE = '#f43f5e';

/** Neutral secondary series, e.g. retirement draw-down years. (Tailwind blue-500.) */
export const CHART_COMPARE = '#3b82f6';

/**
 * Categorical palette cycled across categories/groups/holdings — kept
 * consistent within a render. Index 0 is the brand emerald so a single-series
 * breakdown matches the line charts.
 */
export const CHART_SERIES = [
  '#10b981', // brand-500
  '#3b82f6', // blue-500
  '#f59e0b', // warning-500
  '#a855f7', // purple-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#fb923c', // orange-400
  '#22d3ee', // cyan-400
  '#84cc16', // lime-500
  '#64748b', // slate-500 (the "everything else" tail)
] as const;
