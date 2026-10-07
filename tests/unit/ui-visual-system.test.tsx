// @vitest-environment jsdom
/**
 * UI.1 — the visual system pass (DECISIONS #793). Locks the wiring a restyle
 * can silently drop: the one depth token (and that callers can still override
 * it), the guilt-free split's shared formula, the phone header's accessible
 * sign-out, the Today feed's glyph table covering every proposal kind with a
 * tone that cannot contradict its row, and the chart tooltip surface.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SpendingPlan, SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';
import type { ProposalKind, ProposalTier } from '@/lib/engine/nudge/types';
import { cn } from '@/lib/utils';
import { planSplitWidths } from '@/lib/engine/spending-plan/split-widths';
import { GLYPH_TONE_CLASS, proposalGlyph } from '@/components/dashboard/today-feed-glyph';
import { CHART_TOOLTIP_CONTENT_STYLE } from '@/components/finance/chart-tooltip-style';
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
    // The glow is decoration behind the content, never over it — and only on a covered cycle.
    expect(STAGE_GLOW_CLASS.split(' ')).toEqual(expect.arrayContaining(['isolate', 'before:-z-10', 'before:pointer-events-none']));
    expect(read('src/components/finance/cash-needed-card.tsx')).toContain('className={covered ? STAGE_GLOW_CLASS : undefined}');
  });

  it('a caller can still drop or replace the token (tailwind-merge knows it is a shadow)', () => {
    // Critic P2-2: without the theme extension both classes survived and the token won.
    // (border colour and border width are different properties, so both border classes stay.)
    expect(cn('border-border/80 shadow-surface', 'border-0 shadow-none')).toBe('border-border/80 border-0 shadow-none');
    expect(cn('shadow-surface', 'shadow-lg')).toBe('shadow-lg');
    expect(cn('shadow-surface', 'hover:shadow-surface-hover')).toBe('shadow-surface hover:shadow-surface-hover');
  });
});

describe('UI.1 — the guilt-free split', () => {
  it('is one helper for both surfaces: shares of pattern income, clamped', () => {
    // 309672 / 490000, 35000 / 490000, 145328 / 490000 — as JS prints them.
    expect(planSplitWidths(plan())).toEqual({
      fixed: '63.19836734693878%',
      savings: '7.142857142857142%',
      guiltFree: '29.658775510204084%',
    });
    // Over plan: no guilt-free share, the others still their real share.
    expect(planSplitWidths(plan({ leftToSpendCents: -20000, fixedExpensesCents: 475000 })).guiltFree).toBe('0%');
    // A bonus month: the bar reads the savings this month's PAY funds, not planned savings.
    expect(planSplitWidths(plan({ plannedSavingsCents: 90000, savingsFromPayCents: 35000 })).savings).toBe('7.142857142857142%');
    // Nothing left and nothing fixed: a clean 0% / 0% / 100%.
    expect(planSplitWidths({ patternIncomeCents: 1000, fixedExpensesCents: 0, savingsFromPayCents: 0, leftToSpendCents: 1000 })).toEqual({ fixed: '0%', savings: '0%', guiltFree: '100%' });
    // No income pattern: nothing divides by zero; a stray positive clamps at 100%.
    expect(planSplitWidths({ patternIncomeCents: 0, fixedExpensesCents: 0, savingsFromPayCents: 0, leftToSpendCents: 0 })).toEqual({ fixed: '0%', savings: '0%', guiltFree: '0%' });
    expect(planSplitWidths({ patternIncomeCents: 0, fixedExpensesCents: 500, savingsFromPayCents: 0, leftToSpendCents: 0 }).fixed).toBe('100%');
    // Both surfaces read it.
    const planPage = read('src/app/(app)/spending-plan/page.tsx');
    expect(planPage).toContain('planSplitWidths({');
    expect(planPage).toContain('savingsFromPayCents: p.savingsFromPayCents');
    expect(read('src/components/finance/safe-to-spend-card.tsx')).toContain('planSplitWidths(plan)');
  });

  it('the Home card draws the split, labels only, hidden from the link’s accessible name', () => {
    const html = renderToStaticMarkup(<SafeToSpendCard plan={plan()} disclosures={disclosures} />);
    expect(html).toContain('data-testid="dashboard-safe-to-spend"');
    expect(html).not.toMatch(/class="[^"]*\bh-full\b[^"]*"/);
    expect(html).toMatch(/data-testid="dashboard-safe-to-spend-split" aria-hidden="true"/);
    expect(html).toContain('width:63.19836734693878%');
    expect(html).toContain('width:7.142857142857142%');
    expect(html).toContain('width:29.658775510204084%');
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
});

describe('UI.1 — shell', () => {
  it('the sidebar’s active row is a brand rail (shape) with a visible focus ring, and its icon is lit', () => {
    const nav = read('src/components/app-nav.tsx');
    const fn = nav.slice(nav.indexOf('function sidebarLinkClass'), nav.indexOf('export function AppNav'));
    expect(fn).toContain('before:bg-brand-500');
    expect(fn).toContain('bg-brand-500/12');
    expect(fn).toContain('focus-visible:ring-2 focus-visible:ring-ring');
    const row = nav.slice(nav.indexOf('function SidebarRow'), nav.indexOf('function SheetRow'));
    expect(row).toContain("active ? 'text-brand-500'");
    const bottom = nav.slice(nav.indexOf('data-testid="bottom-nav"'));
    expect(bottom).toContain('focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring');
  });

  it('the phone header’s sign-out is icon-only at the 44px floor with the accessible name kept', () => {
    const nav = read('src/components/app-nav.tsx');
    expect(nav).toContain('<SignOutButton iconOnly />');
    const button = read('src/components/auth/sign-out-button.tsx');
    expect(button).toContain('<span className="sr-only">Sign out</span>');
    expect(button).toContain("'size-11 rounded-full px-0");
    // The sidebar still reads the word.
    expect(button).toMatch(/\) : \(\s*'Sign out'\s*\)/);
  });

  it('the demo banner keeps its facts on one line and truncates rather than spills', () => {
    const layout = read('src/app/(app)/layout.tsx');
    expect(layout).toContain('whitespace-nowrap');
    expect(layout).toContain('<span className="min-w-0 truncate">');
    expect(layout).toContain('<span className="hidden lg:inline"> · fictional accounts</span>');
  });
});

describe('UI.1 — Today feed glyphs', () => {
  const KINDS: ProposalKind[] = [
    'payment_due', 'cash_flow_dip', 'cash_needed_shortfall', 'unusual_charge', 'income_pause',
    'goal_behind_pace', 'unused-subscription', 'price-increase', 'insurance-reshop', 'negotiable-bill',
  ];
  const TIERS: ProposalTier[] = ['critical', 'action', 'opportunity', 'handled'];

  it('every kind × tier has a glyph and a tone class', () => {
    for (const kind of KINDS) {
      for (const tier of TIERS) {
        const g = proposalGlyph(kind, tier);
        expect(g.Icon).toBeTruthy();
        expect(g.toneClass).toBe(GLYPH_TONE_CLASS[g.tone]);
      }
    }
  });

  it('a tone never contradicts its row (critic cycle 1 P1, cycle 2 N1/N2)', () => {
    // A cost that went up is never the green "gains" arrow.
    expect(proposalGlyph('price-increase', 'opportunity').tone).toBe('warning');
    // Money due or short, and a goal behind pace (/goals badges it amber), are warning.
    for (const kind of ['payment_due', 'cash_flow_dip', 'cash_needed_shortfall', 'goal_behind_pace'] as const) {
      expect(proposalGlyph(kind, 'action').tone).toBe('warning');
    }
    // A paused deposit still asking the reader is an action.
    expect(proposalGlyph('income_pause', 'action').tone).toBe('warning');
    expect(proposalGlyph('income_pause', 'critical').tone).toBe('warning');
    // HANDLED is muted for EVERY kind — "Autopay covers this — nothing to do"
    // must never wear a critical due's amber (cycle 2 N1).
    for (const kind of KINDS) {
      expect(proposalGlyph(kind, 'handled').tone).toBe('muted');
      expect(proposalGlyph(kind, 'handled').toneClass).toBe(GLYPH_TONE_CLASS.muted);
    }
    // Outside handled, a kind's tone does not move with the tier.
    for (const kind of KINDS) {
      const tones = new Set(TIERS.filter((t) => t !== 'handled').map((t) => proposalGlyph(kind, t).tone));
      expect(tones.size).toBe(1);
      expect(proposalGlyph(kind, 'critical').tone).not.toBe('muted');
    }
  });

  it('the row renders the glyph decorative, from the helper, with the disclosure under the sentence', () => {
    const feed = read('src/components/dashboard/today-feed-card.tsx');
    expect(feed).toContain("import { proposalGlyph } from '@/components/dashboard/today-feed-glyph'");
    expect(feed).toContain('proposalGlyph(proposal.kind, proposal.tier)');
    expect(feed).toMatch(/data-glyph-tone=\{tone\}\s*aria-hidden/);
    // The <details> sits inside the text column (before the actions column), not after the row.
    const row = feed.slice(feed.indexOf('function ProposalRow'));
    expect(row.indexOf('<details className="mt-1">')).toBeLessThan(row.indexOf('<div className="flex shrink-0 items-start gap-1">'));
    // Dismiss keeps its accessible name while the word is sr-only below sm.
    expect(row).toContain('aria-label={`Dismiss: ${title}`}');
    expect(row).toContain('<span className="max-sm:sr-only">Dismiss</span>');
  });
});

describe('UI.1 — the token is the only depth', () => {
  it('no hand-built card surface still carries shadow-sm beside bg-card (critic cycle 2 N5)', () => {
    const out = execSync('git grep -nE "(bg-card|from-card).*shadow-sm|shadow-sm.*(bg-card|from-card)" -- src || true', {
      encoding: 'utf8',
    });
    expect(out.trim()).toBe('');
    expect(read('src/components/ui/button.tsx')).not.toContain('shadow-[inset');
  });
});

describe('UI.1 — chart tooltip', () => {
  it('every Recharts tooltip reads the one dark popover surface (CI axe: /reports was white on white)', () => {
    expect(CHART_TOOLTIP_CONTENT_STYLE.background).toBe('var(--popover)');
    expect(CHART_TOOLTIP_CONTENT_STYLE.color).toBe('var(--foreground)');
    for (const file of [
      'src/components/finance/reports-view.tsx',
      'src/components/finance/accounts-list.tsx',
      'src/components/finance/forecast-view.tsx',
      'src/components/finance/net-worth-card.tsx',
    ]) {
      const src = read(file);
      expect(src).toContain('contentStyle={CHART_TOOLTIP_CONTENT_STYLE}');
      expect(src).not.toMatch(/contentStyle=\{\{/);
    }
  });
});
