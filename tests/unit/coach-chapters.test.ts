/**
 * Coach IA (#757): nav order is source order — This month, Trajectory, Habits —
 * with goals/household inside Now and rich-life/rules inside Habits.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Coach chapter source order', () => {
  it('test_regression__coach_chapters_match_nav_order_with_no_orphan_cards', () => {
    const page = readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8');
    const now = page.indexOf('id="coach-now"');
    const traj = page.indexOf('id="coach-trajectory"');
    const habits = page.indexOf('id="coach-habits"');
    expect(now).toBeGreaterThan(-1);
    expect(now).toBeLessThan(traj);
    expect(traj).toBeLessThan(habits);

    const nowBlock = page.slice(now, traj);
    const habitsBlock = page.slice(habits);
    expect(nowBlock).toContain('coach-goals-saved-card');
    expect(nowBlock).toContain('coach-household-card');
    expect(habitsBlock).toContain('coach-rich-life');
    expect(habitsBlock).toContain('money-rules-card');

    const afterLastChapter = page.slice(page.lastIndexOf('</CoachChapter>'));
    expect(afterLastChapter).not.toContain('data-testid=');
    expect(nowBlock).toContain('defaultOpen');
    expect(page.slice(traj, habits)).not.toContain('defaultOpen');
    const chapter = readFileSync(resolve('src/components/finance/coach-chapter.tsx'), 'utf8');
    expect(chapter).toContain('<details');
    expect(chapter).toContain('hashchange');
    expect(chapter).toContain('{mounted ? children : null}');
    expect(chapter).toContain('pendingOpen');
    expect(chapter).toContain('preventDefault');
    expect(chapter).toContain('onKeyDown');
    expect(chapter).toContain("event.key !== ' '");
    expect(chapter).toContain('mountedRef');
    expect(chapter).toContain('readyRef');
    expect(chapter).toContain('flushSync');
    expect(chapter).toContain('MutationObserver');
    expect(chapter).toContain("import { flushSync } from 'react-dom'");
    expect(chapter).toContain('!el.open || mountedRef.current');
    expect(chapter).toContain('landmarks');
    expect(chapter).toContain('new URL');
    for (const landmark of [
      'coach-employer-match',
      'coach-tax-advantaged-room',
      'coach-rich-life',
      'coach-money-dials',
    ]) {
      const start = page.indexOf(`id="${landmark}"`);
      expect(start).toBeGreaterThan(-1);
      const tag = page.slice(start, page.indexOf('>', start));
      expect(tag).not.toContain('focus:outline-none');
    }
    expect(page.slice(traj, habits)).toContain("landmarks={['coach-employer-match', 'coach-tax-advantaged-room']}");
    expect(page.slice(habits)).toContain("landmarks={['coach-rich-life', 'coach-money-dials']}");
    expect(chapter).toContain("getAttribute('href')");
    expect(chapter).toContain('node?.focus()');
    expect(chapter).toContain('tabIndex={-1}');
    expect(chapter).toContain('<span className="mt-1 block');
    expect(chapter).not.toContain('<p className="mt-1');
    expect(chapter).not.toContain('marker:content-none');
    expect(chapter).not.toContain('list-none');
    expect(chapter).not.toContain('::-webkit-details-marker');

    const trajLead = page.slice(traj, habits);
    expect(trajLead).toContain('Your savings rate');
    expect(trajLead).not.toContain('one chapter, not a feed');
    expect(trajLead).not.toContain('long-game cards');
    const habitsLead = page.slice(habits, page.indexOf('</CoachChapter>', habits));
    expect(habitsLead).toContain('Your money dials');
    expect(habitsLead).not.toContain('Inputs live here');
  });
});
