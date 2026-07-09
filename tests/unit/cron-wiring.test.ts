/**
 * test_regression__cron_route_scheduled_in_vercel_json (Gap 2 §2/§3 delivery gap).
 *
 * The proactive layer's failure mode was NOT a code bug: `/api/cron/notify` and
 * `/api/cron/digest` were fully built, CRON_SECRET-guarded, and unit-tested, yet
 * they never fired once in production because nobody added them to `vercel.json`
 * crons (documented as the "genuine remaining gap" in COMPETITIVE_GAP_PLAN.md).
 *
 * This pins the wiring both directions so a future session can't reintroduce it:
 *   1. Every `src/app/api/cron/<name>/route.ts` handler has a `vercel.json` crons
 *      entry at `/api/cron/<name>` (a built sweep that is never scheduled).
 *   2. Every scheduled crons[].path resolves to a route directory that exists
 *      (a schedule pointing at a deleted/renamed route → a silent 404 sweep).
 * A textual add of a cron route without scheduling it (or the reverse) goes red.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CRON_DIR = 'src/app/api/cron';

/** Cron route handler directories: those containing a `route.ts`. */
function cronRouteNames(): string[] {
  return readdirSync(CRON_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(`${CRON_DIR}/${e.name}/route.ts`))
    .map((e) => e.name)
    .sort();
}

function scheduledCronPaths(): string[] {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    crons?: Array<{ path: string; schedule: string }>;
  };
  return (vercel.crons ?? []).map((c) => c.path);
}

describe('cron wiring (vercel.json ↔ route coherence)', () => {
  it('every built cron route is scheduled in vercel.json', () => {
    const scheduled = new Set(scheduledCronPaths());
    for (const name of cronRouteNames()) {
      expect(
        scheduled.has(`/api/cron/${name}`),
        `src/app/api/cron/${name}/route.ts exists but is NOT scheduled in vercel.json — a built sweep that never fires`,
      ).toBe(true);
    }
  });

  it('every scheduled cron path resolves to a route that exists', () => {
    const routes = new Set(cronRouteNames().map((n) => `/api/cron/${n}`));
    for (const path of scheduledCronPaths()) {
      expect(
        routes.has(path),
        `vercel.json schedules ${path} but no matching route handler exists — a schedule that 404s`,
      ).toBe(true);
    }
  });

  it('each cron schedule is a well-formed 5-field cron expression', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    for (const { path, schedule } of vercel.crons ?? []) {
      expect(schedule.trim().split(/\s+/), `${path} schedule "${schedule}"`).toHaveLength(5);
    }
  });
});
