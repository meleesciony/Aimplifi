/**
 * The destination catalogue and its search.
 *
 * Owner, 2026-07-31: *"a lot of sections in the app are cumbersome in daily workflow. You
 * basically have to search it in a menu for it to show up. A new user wouldn't have this
 * knowledge."*
 *
 * The menu was fourteen bare nouns, four of which are near-synonyms — Plan, Spending, Reports,
 * Trends — so choosing between them was a memory test rather than a reading task. These lock the
 * two things that fix it: every destination SAYS what it answers, and a reader can type their own
 * word for it instead of recognising the app's.
 */
import { describe, expect, it } from 'vitest';

import {
  NAV_DESTINATIONS,
  PRIMARY_DESTINATIONS,
  SHEET_DESTINATIONS,
} from '@/lib/nav/destinations';
import { matchesQuery, searchDestinations } from '@/lib/nav/search';

describe('the catalogue describes every destination', () => {
  it('gives each one a description, and never leaves a label to stand alone', () => {
    // An item WITH a description beside one without reads as the important one — a ranking
    // nobody intended. So this is all-or-nothing, and the assertion is on every row.
    for (const d of NAV_DESTINATIONS) {
      expect(d.description.length, d.href).toBeGreaterThan(20);
      expect(d.description.trim().endsWith('.'), `${d.href} description is a sentence`).toBe(true);
      expect(d.label.length, d.href).toBeGreaterThan(0);
    }
  });

  it('has no duplicate href, label or testid', () => {
    for (const key of ['href', 'label', 'testid'] as const) {
      const values = NAV_DESTINATIONS.map((d) => d[key]);
      expect(new Set(values).size, `duplicate ${key}`).toBe(values.length);
    }
  });

  it('splits into exactly the five bottom tabs and the rest', () => {
    expect(PRIMARY_DESTINATIONS).toHaveLength(5);
    expect(PRIMARY_DESTINATIONS.map((d) => d.href)).toEqual([
      '/dashboard',
      '/cards',
      '/triage',
      '/coach',
      '/calendar',
    ]);
    expect(SHEET_DESTINATIONS.length).toBe(NAV_DESTINATIONS.length - 5);
    expect(SHEET_DESTINATIONS.every((d) => d.group !== 'primary')).toBe(true);
  });

  it('tells the four near-synonyms apart in their descriptions alone', () => {
    // The actual defect: "Plan" is /spending-plan, "Spending" is /budgets, and "Reports" and
    // "Trends" are both charts of spending. Read the four descriptions with the labels hidden —
    // each has to name something the other three do not.
    const by = (href: string) =>
      NAV_DESTINATIONS.find((d) => d.href === href)!.description.toLowerCase();
    expect(by('/spending-plan')).toContain('guilt-free');
    expect(by('/budgets')).toContain('targets you set');
    expect(by('/reports')).toContain('six months');
    expect(by('/trends')).toContain('changed');
    const four = ['/spending-plan', '/budgets', '/reports', '/trends'].map(by);
    expect(new Set(four).size).toBe(4);
  });
});

describe('searchDestinations — type what you want, not what it is called', () => {
  const find = (q: string) => searchDestinations(NAV_DESTINATIONS, q).map((d) => d.href);

  it('shows the whole menu for an empty or whitespace query', () => {
    // The box is an accelerator laid over the menu, never a gate in front of it: a reader who
    // opens the sheet and types nothing must see exactly what they saw before it existed.
    expect(find('')).toEqual(NAV_DESTINATIONS.map((d) => d.href));
    expect(find('   ')).toHaveLength(NAV_DESTINATIONS.length);
  });

  it('finds a page by a word that is in NEITHER its label nor its description', () => {
    // This is the whole point. "Subscriptions" is the reader's word for /recurring; "Netflix" is
    // the reader's word for subscriptions. Neither appears in the label.
    expect(find('subscriptions')).toContain('/recurring');
    expect(find('netflix')).toContain('/recurring');
    expect(find('401k')).toContain('/investments');
    expect(find('overdraft')).toContain('/forecast');
    expect(find('csv')).toContain('/transactions');
    expect(find('inflation')).toContain('/settings');
  });

  it('is case-insensitive', () => {
    expect(find('NETFLIX')).toEqual(find('netflix'));
    expect(find('Goals')).toContain('/goals');
  });

  it('ANDs the tokens, so more words narrow rather than widen', () => {
    const budget = find('budget');
    // "Budget" is genuinely ambiguous here and SHOULD return both spending pages — that is the
    // reader's confusion made visible rather than hidden behind one arbitrary pick.
    expect(budget).toContain('/spending-plan');
    expect(budget).toContain('/budgets');
    // Adding a word must cut the set down, never grow it.
    const narrowed = find('budget targets');
    expect(narrowed).toEqual(['/budgets']);
    expect(narrowed.length).toBeLessThan(budget.length);
  });

  it('returns an empty list rather than pretending, for a query that matches nothing', () => {
    // A real state the surface has to render as "nothing matched": an empty list and a menu that
    // failed to load look identical, and only one of them is the reader's fault.
    expect(find('zzzzqqq')).toEqual([]);
  });

  it('preserves catalogue order rather than ranking', () => {
    const results = find('spending');
    const positions = results.map((h) => NAV_DESTINATIONS.findIndex((d) => d.href === h));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('matches substrings, so a partial word still finds the page', () => {
    expect(find('scription')).toContain('/recurring');
    expect(matchesQuery(NAV_DESTINATIONS.find((d) => d.href === '/coach')!, 'independ')).toBe(true);
  });

  it('every destination is reachable by at least one query that is not its own label', () => {
    // A row whose only handle is the word a new user does not know is a row still hiding in the
    // menu. Each must answer to something else it says about itself.
    for (const d of NAV_DESTINATIONS) {
      const handles = [...d.keywords, ...d.description.toLowerCase().split(/[^a-z0-9]+/)]
        .filter((w) => w.length > 4 && !d.label.toLowerCase().includes(w));
      expect(handles.length, `${d.href} has no handle besides its label`).toBeGreaterThan(0);
      expect(searchDestinations(NAV_DESTINATIONS, handles[0]).map((x) => x.href)).toContain(d.href);
    }
  });
});
