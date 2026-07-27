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
import { describe, expect, it } from 'vitest';
import { SYNC_REVALIDATE_PATHS } from '@/server/sync-revalidate';

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
  it('has no dynamic route segment, which this check could not handle silently', () => {
    // A latent trap the critic caught (P2-7): if a `[param]` route is ever added, the
    // walk below would demand a literal '/x/[id]' entry — and `revalidatePath('/x/[id]')`
    // without its second `'page'` argument marks NOTHING, so the test would go green
    // over an entry that does no work. There are none today; this fails loudly on the
    // day one appears, rather than quietly accepting a useless entry.
    const dynamic = routesUnderAppGroup(APP_DIR).filter((r) => r.includes('['));
    expect(dynamic, 'add the type-aware revalidatePath(path, "page") form for these').toEqual([]);
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
