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
  });
});
