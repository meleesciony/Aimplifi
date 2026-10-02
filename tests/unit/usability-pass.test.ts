/**
 * Usability pass, wave 1 (TASKS U.1a). The defects here were all found by looking at
 * the rendered app at 380px, and each is a small rule that had no lock:
 *
 *   - a feed sentence may not point at a section the page does not render;
 *   - a `<summary>` that gives up its native triangle must draw its own;
 *   - a money figure and an account name may not be split mid-token to fit a column;
 *   - the Settings index may not link to an anchor that is not there.
 *
 * The browser half (what the reader actually sees) is `tests/e2e/usability-pass.spec.ts`.
 * These are the source-level rules that keep it true as files change.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cents, type Cents } from '@/lib/money';
import type { Proposal, ProposalKind, ProposalTier } from '@/lib/engine/nudge/types';
import { proposalCopy, proposalRouteLink } from '@/components/dashboard/today-feed-copy';
import {
  SETTINGS_NOTIFICATIONS_ID,
  SETTINGS_SECTION_GROUPS,
  settingsIndexGroups,
} from '@/lib/ui/settings-sections';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

function prop(o: Partial<Proposal> & { kind: ProposalKind; tier: ProposalTier }): Proposal {
  return {
    key: 'k',
    dismissKey: 'k',
    subjectKey: `nudge:${o.kind}` as Proposal['subjectKey'],
    sortDate: null,
    daysUntil: null,
    centsAtStake: cents(1000) as Cents,
    autopayCents: cents(0) as Cents,
    merchant: null,
    accountName: null,
    typicalCents: null,
    typicalCount: null,
    cadence: null,
    runwayMonths: null,
    runwayWindowMonths: null,
    goalNudge: null,
    isEstimated: false,
    fundingFrozen: null,
    dismissed: false,
    ...o,
  };
}

const RECURRING_KINDS: ProposalKind[] = [
  'price-increase',
  'unused-subscription',
  'insurance-reshop',
  'negotiable-bill',
];

describe('Today feed — a pointer is a link to a route, never a position that may not exist', () => {
  it('test_regression__feed_copy_no_longer_says_recurring_below', () => {
    // "Details in Recurring below." outlived the Recurring card it pointed at: Home
    // stopped rendering one, and four kinds kept sending the reader to it.
    for (const kind of RECURRING_KINDS) {
      const { detail } = proposalCopy(prop({ kind, tier: 'opportunity' }));
      expect(detail, kind).not.toMatch(/\b(below|above)\b/i);
      expect(detail, kind).not.toContain('Recurring');
    }
  });

  it('the four recurring-detector kinds link to Coach, where each is listed by name', () => {
    for (const kind of RECURRING_KINDS) {
      expect(proposalRouteLink(prop({ kind, tier: 'opportunity' })), kind).toEqual({
        href: '/coach#worth-a-look',
        label: 'See which one in Coach',
      });
    }
    // The anchor is the card that holds the list — one constant on both ends, so the link
    // cannot point at an id the page stopped carrying.
    const coach = read('src/app/(app)/coach/page.tsx');
    expect(coach).toContain('<Card id={COACH_OPPORTUNITIES_ID}');
    expect(coach).toMatch(/<Card id=\{COACH_OPPORTUNITIES_ID\}[^>]*data-testid="opportunities-card"/);
  });

  it('…and that destination really lists them: Coach renders the array Home feeds the feed', () => {
    // The link is only an answer to "which one?" while both pages read ONE list. /recurring
    // was the first destination and marks just two of the four kinds (critic P1-3) — so the
    // claim "you will find it there" is pinned to the wiring, not left to a label.
    const home = read('src/app/(app)/dashboard/page.tsx');
    expect(home).toContain('opportunities: coach.opportunities');
    const coach = read('src/app/(app)/coach/page.tsx');
    const list = coach.slice(coach.indexOf('data-testid="opportunities-list"'));
    const row = list.slice(0, list.indexOf('</ul>'));
    expect(row).toContain('data.opportunities.map(');
    expect(row, 'each opportunity is named').toContain('{o.merchant}');
    expect(row, 'with its monthly figure').toContain('formatCents(o.monthlyCents)');
  });

  it('no other kind borrows that link', () => {
    const others: Array<{ kind: ProposalKind; tier: ProposalTier }> = [
      { kind: 'payment_due', tier: 'critical' },
      { kind: 'cash_needed_shortfall', tier: 'critical' },
      { kind: 'cash_flow_dip', tier: 'critical' },
      { kind: 'unusual_charge', tier: 'action' },
      { kind: 'income_pause', tier: 'action' },
    ];
    for (const o of others) expect(proposalRouteLink(prop(o)), o.kind).toBeNull();
  });

  it('the two positional pointers that remain are true of the page that renders the feed', () => {
    // `cash_needed_shortfall` says "See what’s due above" and `cash_flow_dip` says "See
    // Cash Flow Radar below". Both are claims about Home's ORDER, so the order is what
    // this pins: the day one of those cards moves or leaves, this fails here instead of
    // the sentence quietly becoming the next "Recurring below".
    const shortfall = proposalCopy(prop({ kind: 'cash_needed_shortfall', tier: 'critical' })).detail;
    const dip = proposalCopy(prop({ kind: 'cash_flow_dip', tier: 'critical' })).detail;
    expect(shortfall).toContain('above');
    expect(dip).toContain('Cash Flow Radar below');

    const home = read('src/app/(app)/dashboard/page.tsx');
    const cashNeeded = home.indexOf('<CashNeededCard');
    const feed = home.indexOf('<TodayFeedCard');
    const radar = home.indexOf('<CashFlowRadarCard');
    expect(cashNeeded, 'Home renders the cash-needed card').toBeGreaterThan(-1);
    expect(feed, 'Home renders the Today feed').toBeGreaterThan(-1);
    expect(radar, 'Home renders the cash-flow radar').toBeGreaterThan(-1);
    expect(cashNeeded, '"above": cash needed comes before the feed').toBeLessThan(feed);
    expect(radar, '"below": the radar comes after the feed').toBeGreaterThan(feed);
  });
});

describe('Settings index — every entry is an anchor the page carries', () => {
  const page = read('src/app/(app)/settings/page.tsx');
  const ids = SETTINGS_SECTION_GROUPS.flatMap((g) => g.sections.map((s) => s.id));

  it('ids are unique', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each id is an `id="…"` on the settings page', () => {
    for (const id of ids) expect(page, id).toContain(`id="${id}"`);
  });

  it('the page has no index-style anchor the list forgot', () => {
    // Every `scroll-mt-20` target on the page is a section someone can be sent to, so
    // each one should be reachable from the index too.
    const anchored = [...page.matchAll(/id="([a-z-]+)"[^>]*(?:scroll-mt-20|SECTION_ANCHOR_CLASS)/g)].map(
      (m) => m[1],
    );
    expect(anchored.length).toBeGreaterThanOrEqual(ids.length);
    for (const id of anchored) expect(ids, id).toContain(id);
  });

  it('Notifications is listed only when the card renders', () => {
    const has = (groups: ReturnType<typeof settingsIndexGroups>) =>
      groups.some((g) => g.sections.some((s) => s.id === SETTINGS_NOTIFICATIONS_ID));
    expect(has(settingsIndexGroups({ notifications: true }))).toBe(true);
    expect(has(settingsIndexGroups({ notifications: false }))).toBe(false);
    // …and it is the ONLY entry that depends on anything.
    const count = (n: boolean) =>
      settingsIndexGroups({ notifications: n }).reduce((t, g) => t + g.sections.length, 0);
    expect(count(true) - count(false)).toBe(1);
  });
});

describe('disclosures — a summary without its native triangle draws its own', () => {
  function tsxFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return tsxFiles(full);
      return name.endsWith('.tsx') ? [full] : [];
    });
  }

  it('every flex / grid <summary> carries a DisclosureChevron', () => {
    // A summary keeps the browser's triangle only while it is `display: list-item`.
    // Laying it out with flex or grid (for the 44px tap floor) drops the triangle, and
    // five Coach rests shipped that way — bold sentences with nothing saying they open.
    const offenders: string[] = [];
    let checked = 0;
    let seen = 0;
    for (const file of tsxFiles(path.join(ROOT, 'src'))) {
      const src = readFileSync(file, 'utf8');
      // The whole element, then its `className` VALUE — not "the attributes up to the first
      // `>`", which stops inside an arrow handler (`onClick={() =>`) and would skip any
      // summary that carries one before its className (critic cycle 3, P2-4).
      for (const m of src.matchAll(/<summary\b[\s\S]*?<\/summary>/g)) {
        const el = m[0];
        seen += 1;
        const cls = el.match(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{([A-Za-z_]+)\})/);
        const classText = cls ? (cls[1] ?? cls[2] ?? cls[3] ?? '') : '';
        const laidOut = /\b(flex|grid)\b/.test(classText) || classText.includes('DISCLOSURE_SUMMARY_CLASS');
        if (!laidOut) continue;
        checked += 1;
        if (!el.includes('<DisclosureChevron')) {
          offenders.push(`${path.relative(ROOT, file)}: ${el.trim().slice(0, 80)}`);
        }
      }
    }
    // Both chapter summaries carry arrow handlers ahead of their className; if the scan
    // could not read past those, `seen` would not reach the list-item summaries at all.
    expect(seen, 'the scan reads every <summary>, handlers and all').toBeGreaterThanOrEqual(15);
    expect(checked, 'the scan found the summaries it exists to check').toBeGreaterThanOrEqual(6);
    expect(offenders).toEqual([]);
  });

  it('the chapter headers keep the native triangle and put the title on its line', () => {
    for (const rel of ['src/components/finance/home-chapter.tsx', 'src/components/finance/coach-chapter.tsx']) {
      const src = read(rel);
      // The triangle is the browser's (home-chapters.test.ts forbids removing it); the
      // title must be inline or it drops to the line below and strands the triangle.
      expect(src, rel).toMatch(/<h2 className="inline /);
    }
  });
});

describe('figures and names are never split mid-token to fit a column', () => {
  it('forecast milestones: the balance does not wrap', () => {
    const src = read('src/components/finance/forecast-view.tsx');
    const tile = src.slice(src.indexOf('data-testid="forecast-milestones"'), src.indexOf('{/* Balance line */}'));
    expect(tile).toContain('whitespace-nowrap');
    expect(tile).not.toContain('break-words');
    expect(tile).not.toContain('break-all');
  });

  it('register account names wrap at spaces (`anywhere`), not at any character (`break-all`)', () => {
    for (const rel of [
      'src/components/finance/transaction-list.tsx',
      'src/components/finance/shared-transaction-list.tsx',
    ]) {
      const src = read(rel);
      expect(src, rel).toContain('<span className="[overflow-wrap:anywhere]">{t.accountName}</span>');
      expect(src, rel).not.toContain('<span className="break-all">{t.accountName}</span>');
    }
  });
});
