/**
 * Home IA (#758): after the stage and the daily loop, Adjust / Picture / Setup
 * start closed so a phone is not a feature dump.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Home chapter source order', () => {
  it('test_regression__home_chapters_keep_the_daily_loop_open_and_the_dump_closed', () => {
    const page = readFileSync(resolve('src/app/(app)/dashboard/page.tsx'), 'utf8');
    const stage = page.indexOf('data-testid="home-stage"');
    const recent = page.indexOf('<RecentTransactionsCard');
    const today = page.indexOf('<TodayFeedCard');
    const goals = page.indexOf('<GoalsProgressCard');
    const stale = page.indexOf('<StaleDataBanner');
    const welcome = page.indexOf('<ReturnMomentCard');
    const adjust = page.indexOf('id="home-adjust"');
    const radar = page.indexOf('<CashFlowRadarCard');
    const nav = page.indexOf('data-testid="home-chapter-nav"');
    const picture = page.indexOf('id="home-picture"');
    const setup = page.indexOf('id="home-setup"');

    expect(stage).toBeGreaterThan(-1);
    expect(stage).toBeLessThan(recent);
    expect(recent).toBeLessThan(today);
    expect(today).toBeLessThan(goals);
    expect(goals).toBeLessThan(stale);
    expect(stale).toBeLessThan(welcome);
    expect(welcome).toBeLessThan(radar);
    expect(radar).toBeLessThan(nav);
    expect(nav).toBeLessThan(adjust);
    expect(page.slice(nav, adjust)).toContain('#home-adjust');
    expect(page.slice(nav, adjust)).toContain('#home-picture');
    expect(page).toContain('const showHomeSetup = canDeepenHistory || Boolean(vapidPublicKey)');
    expect((page.match(/showHomeSetup/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(adjust).toBeLessThan(picture);
    expect(picture).toBeLessThan(setup);

    const adjustBlock = page.slice(adjust, picture);
    const pictureBlock = page.slice(picture, setup);
    expect(adjustBlock).toContain('home-plan-figures');
    expect(adjustBlock).toContain('PlanFiguresForm');
    expect(pictureBlock).toContain('NetWorthCard');
    expect(pictureBlock).toContain('SavingsRateCard');
    expect(pictureBlock).toContain('SpendingInsightsCard');

    const openLoop = page.slice(0, adjust);
    expect(openLoop).toContain('CurrencyExclusionBanner');
    expect(openLoop).toContain('FeedDroppedBanner');
    expect(openLoop).toContain('StaleDataBanner');
    expect(openLoop).toContain('ConnectionAlertsCard');
    expect(openLoop).toContain('<ReturnMomentCard');
    expect(openLoop).toContain('<CashFlowRadarCard');

    expect(adjustBlock).not.toContain('defaultOpen');
    expect(pictureBlock).not.toContain('defaultOpen');

    const chapter = readFileSync(resolve('src/components/finance/home-chapter.tsx'), 'utf8');
    expect(chapter).toContain('<details');
    expect(chapter).toContain('hashchange');
    expect(chapter).toContain('{mounted ? children : null}');
    expect(chapter).toContain('pendingOpen');
    expect(chapter).toContain('preventDefault');
    expect(chapter).toContain('new URL');
    expect(chapter).toContain("getAttribute('href')");
    expect(chapter).toContain('el.focus()');
    expect(chapter).toContain('tabIndex={-1}');
    expect(chapter).toContain('<span className="mt-1 block');
    expect(chapter).not.toContain('<p className="mt-1');
    expect(chapter).not.toContain('marker:content-none');
  });
});
