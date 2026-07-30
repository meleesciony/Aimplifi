/**
 * test_regression__a_new_page_cannot_be_forgotten_by_the_sync_revalidation (L.28)
 *
 * A bank sync used to revalidate two hand-maintained path lists that had drifted apart,
 * and `/spending-plan` — the page whose guilt-free breakdown is summed from the rows a
 * sync rewrites LAST — was in neither. Replacing them with one list only helps until
 * someone adds a route and forgets it, which is the same forgettable-enumeration defect
 * this slice exists to close.
 *
 * So the list is checked against the filesystem instead of against anyone's memory: the
 * authenticated route group IS the source of truth, and this fails the moment a page is
 * added without one.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SYNC_REVALIDATE_PATHS, revalidateAfterSync } from '@/server/sync-revalidate';

/** Every `revalidatePath` call the module makes, with its `type` argument. */
const { marks } = vi.hoisted(() => ({ marks: [] as { path: string; type?: string }[] }));
vi.mock('next/cache', () => ({
  revalidatePath: (path: string, type?: string) => {
    marks.push({ path, type });
  },
}));

const APP_DIR = join(process.cwd(), 'src', 'app', '(app)');

/** Every route under `src/app/(app)` that renders a page, as a URL path. */
function routesUnderAppGroup(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Route groups `(x)` and private folders `_x` add no URL segment; there are none
    // nested here today, but skipping them keeps this honest if one appears.
    if (entry.name.startsWith('(') || entry.name.startsWith('_')) continue;
    const path = `${prefix}/${entry.name}`;
    if (existsSync(join(dir, entry.name, 'page.tsx'))) out.push(path);
    out.push(...routesUnderAppGroup(join(dir, entry.name), path));
  }
  return out;
}

describe('the sync revalidation list', () => {
  /**
   * The day predicted by the original tripwire arrived: O.13b added
   * `/transactions/[id]`, the app's first dynamic route, and this test failed
   * exactly as it was written to.
   *
   * Its replacement is stronger than the tripwire, because a list entry alone
   * proves nothing here: `revalidatePath('/x/[id]')` with a bare string marks
   * NOTHING, so coverage of a dynamic route can only be demonstrated by the
   * second `'page'` argument actually being passed. Fail-old verified by
   * reverting the branch in `revalidateAfterSync` — the dynamic assertion fails
   * and no other does.
   */
  it('marks a dynamic route with the type-aware "page" form, not the bare path', () => {
    marks.length = 0;
    revalidateAfterSync();

    const dynamic = routesUnderAppGroup(APP_DIR).filter((r) => r.includes('['));
    // Non-trivial fixture: with no dynamic route on disk this would assert nothing.
    expect(dynamic).toContain('/transactions/[id]');

    for (const route of dynamic) {
      expect(marks, `${route} must be marked with the "page" form`).toContainEqual({
        path: route,
        type: 'page',
      });
    }
    // …and a literal path is still marked the ordinary way, so the branch above
    // did not quietly change how every other route is invalidated.
    expect(marks).toContainEqual({ path: '/transactions', type: undefined });
    expect(marks).toHaveLength(SYNC_REVALIDATE_PATHS.length);
  });

  it('covers every authenticated route, with nothing invented', () => {
    const onDisk = routesUnderAppGroup(APP_DIR).sort();

    // The fixture has to be non-trivial or this asserts nothing: if the walk found no
    // routes, an empty list would "cover" them all.
    expect(onDisk.length).toBeGreaterThan(15);
    expect(onDisk).toContain('/spending-plan');
    expect(onDisk).toContain('/transactions/new');

    // Both directions. Missing a route leaves a stale money figure on screen; naming a
    // route that does not exist is a claim about the app that quietly stops being true.
    expect([...SYNC_REVALIDATE_PATHS].sort()).toEqual(onDisk);
  });
});
