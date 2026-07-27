/**
 * The e2e `test` every spec must import (never `@playwright/test` directly — eslint enforces it).
 *
 * WHY THIS EXISTS — O.3, the four-spec /accounts flake that stopped `verify.sh` discriminating.
 *
 * React streams a resolved Suspense boundary into a hidden staging container and emits
 * `$RC(boundaryId, stagingId)` to move it into place. `$RC` does not move anything inline. It
 * queues the pair on `$RB` and schedules a drain — and for the FIRST batch on a document that
 * schedule is `requestAnimationFrame($RV.bind(null, $RB))` (read out of the shipped bundle,
 * `next/dist/compiled/react-dom/cjs/react-dom-server.edge.production.js`; the byte-identical code
 * is in React's experimental channel too, so there is no version to upgrade to):
 *
 *     $RC = function (a, b) { … $RB.push(a, b), 2 === $RB.length && (
 *             "number" !== typeof $RT ? requestAnimationFrame($RV.bind(null, $RB))
 *                                     : setTimeout($RV.bind(null, $RB), …)) … }
 *
 * `$RT` is assigned on the first line of `$RV`, so it is only ever a number *after* a drain has
 * run. The very first reveal on a page is therefore the one and only frame-dependent one — and a
 * renderer that issues no frames never runs it. The content stays parked in `div[hidden][id^="S:"]`
 * for as long as the page lives, which is how a strict locator came to resolve to two elements,
 * both hidden. Measured, not inferred: with `requestAnimationFrame` replaced by a no-op, a plain
 * `/accounts` load leaves `$RT === undefined` and `$RB.length === 2` with the whole card staged;
 * with the drain below installed under the same starvation, both readings match an unstarved load
 * exactly (`$RT` a number, `$RB` empty, no staging container). See
 * `tests/e2e/streamed-reveal.spec.ts` for that as a standing lock.
 *
 * The drain below is not a workaround for a product defect — a real browser paints, so a real
 * reader always gets the frame, and the orphan sits outside `#content` where nothing can reach it.
 * It removes the harness's dependency on a frame the machine will not always produce, by doing
 * exactly what React's own rAF callback would have done, on a timer instead. It cannot hide a
 * genuine duplicate render: that puts both copies inside `#content`, where every strict locator
 * still sees two.
 */
import { test as base, expect, type BrowserContext } from '@playwright/test';

/** How often the drain checks for a queued-but-unrevealed boundary. A frame would be ~16ms. */
export const REVEAL_DRAIN_INTERVAL_MS = 32;

/**
 * Runs in the page. Idempotent by construction: `$RV` ends with `a.length = 0`, so a drain that
 * races a real frame finds an empty queue and does nothing. After the first drain `$RT` is a
 * number and React's own scheduling switches to `setTimeout`, which needs no frames either.
 */
function revealDrainScript(intervalMs: number): string {
  return `(() => {
    const w = window;
    setInterval(() => {
      if (typeof w.$RV === 'function' && Array.isArray(w.$RB) && w.$RB.length > 0) w.$RV(w.$RB);
    }, ${intervalMs});
  })();`;
}

/** Contexts already carrying the drain, so the `browser` and `context` hooks cannot double-install. */
const installed = new WeakSet<BrowserContext>();

async function installRevealDrain(context: BrowserContext): Promise<void> {
  if (installed.has(context)) return;
  installed.add(context);
  await context.addInitScript(revealDrainScript(REVEAL_DRAIN_INTERVAL_MS));
}

export const test = base.extend({
  /**
   * Patched so that contexts a spec creates ITSELF (`browser.newContext()` — notifications,
   * payment-reminders, phase4-features) are covered too. A fence copied per call site misses call
   * sites, so the capability is wrapped once here rather than remembered three times.
   */
  browser: async ({ browser }, run) => {
    const patched = browser as typeof browser & { __revealDrainPatched?: true };
    if (!patched.__revealDrainPatched) {
      patched.__revealDrainPatched = true;
      const original = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const context = await original(options);
        await installRevealDrain(context);
        return context;
      };
    }
    await run(browser);
  },

  /**
   * Belt and braces for the default page's context, which Playwright may build through an internal
   * path rather than the public `newContext` patched above. The WeakSet makes the overlap free.
   */
  context: async ({ context }, run) => {
    await installRevealDrain(context);
    await run(context);
  },
});

export { expect };
export type { Locator, Page } from '@playwright/test';
