// @vitest-environment jsdom
/**
 * UI.1 — the visual system pass (DECISIONS #793). Locks the wiring a restyle
 * can silently drop: the one depth token, the stage pair's shared height, the
 * guilt-free split's borrowed formula, the phone header's accessible sign-out,
 * and the Today feed's glyph table covering every proposal kind.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SpendingPlan, SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';
import {
  STAGE_GLOW_CLASS,
  SURFACE_CARD_CLASS,
  SURFACE_LINK_CARD_CLASS,
} from '@/components/finance/surface-card-styles';

vi.mock('@/server/engagement-actions', () => ({ logEngagement: vi.fn() }));
import { SafeToSpendCard } from '@/components/finance/safe-to-spend-card';

const read = (file: string) => readFileSync(resolve(file), 'utf8');

/** The fields the card and its copy helpers read; nothing else is consulted. */
function plan(over: Partial<SpendingPlan> = {}): SpendingPlan {
  return {
    patternIncomeCents: 490000,
    fixedExpensesCents: 309672,
    plannedSavingsCents: 35000,
    savingsFromPayCents: 35000,
    leftToSpendCents: 145328,
    leftToSpendFromPayCents: 145328,
    bonusTowardSavingsCents: 0,
    overspent: false,
    scheduledFixed: [],
    ...over,
  } as unknown as SpendingPlan;
}
const disclosures = {} as SpendingPlanDisclosures;

describe('UI.1 — one depth token', () => {
  it('globals.css defines shadow-surface from a per-theme value, and the card primitive uses it', () => {
    const css = read('src/app/globals.css');
    expect(css).toContain('--shadow-surface: var(--surface-shadow);');
    expect(css).toContain('--shadow-surface-hover: var(--surface-shadow-hover);');
    // Both themes carry a value — a missing one renders `shadow-surface` as nothing.
    expect(css.match(/--surface-shadow:/g)?.length).toBe(2);
    expect(read('src/components/ui/card.tsx')).toContain('shadow-surface');
  });

  it('the summary-card surfaces share the token and keep the a11y invariants', () => {
    for (const cls of [SURFACE_CARD_CLASS, SURFACE_LINK_CARD_CLASS]) {
      expect(cls.split(' ')).toContain('shadow-surface');
      expect(cls.split(' ')).not.toContain('shadow-sm');
    }
    expect(SURFACE_LINK_CARD_CLASS.split(' ')).toContain('hover:shadow-surface-hover');
    // The glow is decoration behind the content, never over it.
    expect(STAGE_GLOW_CLASS.split(' ')).toEqual(expect.arrayContaining(['isolate', 'before:-z-10', 'before:pointer-events-none']));
    expect(read('src/components/finance/cash-needed-card.tsx')).toContain('className={STAGE_GLOW_CLASS}');
  });
});

describe('UI.1 — the Home stage pair', () => {
  it('the guilt-free card fills its grid cell and draws the plan page’s split, labels only', () => {
    const html = renderToStaticMarkup(<SafeToSpendCard plan={plan()} disclosures={disclosures} />);
    expect(html).toContain('data-testid="dashboard-safe-to-spend"');
    expect(html).toMatch(/class="[^"]*\bh-full\b[^"]*"/);
    expect(html).toContain('data-testid="dashboard-safe-to-spend-split"');
    // Widths are the plan page's `pct` of pattern income: 309672/490000, 35000/490000, 145328/490000.
    expect(html).toContain('width:63.198367346938');
    expect(html).toContain('width:7.142857142857');
    expect(html).toContain('width:29.658775510204');
    for (const label of ['Fixed', 'Savings', 'Guilt-free']) expect(html).toContain(label);
    // Labels only — the split never prints a figure the plan page owns.
    expect(html).not.toContain('$3,096.72');
    expect(html).not.toContain('$350.00');
    expect(html).toContain('$1,453.28');
  });

  it('an over-plan month shows no split (there is no guilt-free share to draw)', () => {
    const html = renderToStaticMarkup(
      <SafeToSpendCard plan={plan({ overspent: true, leftToSpendCents: -20000, leftToSpendFromPayCents: -20000 })} disclosures={disclosures} />,
    );
    expect(html).toContain('Over plan by $200.00');
    expect(html).not.toContain('dashboard-safe-to-spend-split');
  });

  it('the split’s formula is the plan page’s, verbatim', () => {
    const formula = 'Math.max(0, Math.min(100, (n / total) * 100))';
    expect(read('src/components/finance/safe-to-spend-card.tsx')).toContain(formula);
    expect(read('src/app/(app)/spending-plan/page.tsx')).toContain(formula);
    expect(read('src/components/finance/safe-to-spend-card.tsx')).toContain('Math.max(1, plan.patternIncomeCents)');
    expect(read('src/app/(app)/spending-plan/page.tsx')).toContain('Math.max(1, p.patternIncomeCents)');
  });
});

describe('UI.1 — shell', () => {
  it('the sidebar’s active row is a brand rail (shape), and its icon is lit', () => {
    const nav = read('src/components/app-nav.tsx');
    const fn = nav.slice(nav.indexOf('function sidebarLinkClass'), nav.indexOf('export function AppNav'));
    expect(fn).toContain('before:bg-brand-500');
    expect(fn).toContain('bg-brand-500/12');
    const row = nav.slice(nav.indexOf('function SidebarRow'), nav.indexOf('function SheetRow'));
    expect(row).toContain("active ? 'text-brand-500'");
  });

  it('the phone header’s sign-out is icon-only with the accessible name kept', () => {
    const nav = read('src/components/app-nav.tsx');
    expect(nav).toContain('<SignOutButton iconOnly />');
    const button = read('src/components/auth/sign-out-button.tsx');
    expect(button).toContain('<span className="sr-only">Sign out</span>');
    // The sidebar still reads the word.
    expect(button).toMatch(/\) : \(\s*'Sign out'\s*\)/);
  });

  it('the demo banner keeps its facts on one phone line', () => {
    const layout = read('src/app/(app)/layout.tsx');
    expect(layout).toContain('whitespace-nowrap');
    expect(layout).toContain('<span className="hidden sm:inline"> · fictional accounts</span>');
  });
});

describe('UI.1 — Today feed glyphs', () => {
  it('every proposal kind has a glyph (the table is typed Record<ProposalKind, …> and lists each key)', () => {
    const feed = read('src/components/dashboard/today-feed-card.tsx');
    expect(feed).toContain('const KIND_GLYPH: Record<ProposalKind, { Icon: LucideIcon; tone: string }>');
    const table = feed.slice(feed.indexOf('const KIND_GLYPH'), feed.indexOf('function ProposalRow'));
    for (const kind of [
      'payment_due', 'cash_flow_dip', 'cash_needed_shortfall', 'unusual_charge', 'income_pause',
      'goal_behind_pace', "'unused-subscription'", "'price-increase'", "'insurance-reshop'", "'negotiable-bill'",
    ]) {
      expect(table).toContain(kind);
    }
    // Decorative: the glyph never becomes the only carrier of the kind.
    expect(feed).toMatch(/rounded-full \$\{tone\}`\}\s*aria-hidden/);
  });
});
