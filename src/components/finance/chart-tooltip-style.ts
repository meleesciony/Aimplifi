import type { CSSProperties } from 'react';

/**
 * The one Recharts tooltip surface (DECISIONS #793). Recharts' default tooltip
 * is a white box with inherited ink — on this dark app that is near-white text
 * on white (axe measured 1.08:1 on /reports in CI, the moment a pointer rested
 * on a bar). Every `<Tooltip>` spreads this so the four charts share one
 * popover: the app's popover surface, border, ink and depth token.
 */
export const CHART_TOOLTIP_CONTENT_STYLE: CSSProperties = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  boxShadow: 'var(--surface-shadow)',
  color: 'var(--foreground)',
  fontSize: 12,
};

/** The label line (a date or month) reads as a caption above the figures. */
export const CHART_TOOLTIP_LABEL_STYLE: CSSProperties = {
  color: 'var(--muted-foreground)',
  marginBottom: 4,
};
