/**
 * Owner report 2026-07-29: *"the login is buggy. When I click login, it sometimes
 * says wrong pw. I click it again, it works."*
 *
 * WHAT THIS ISOLATES. `PasswordInput` (src/components/auth/password-input.tsx)
 * registers a CAPTURE-phase submit listener that flips `el.type` back to
 * 'password' before the form serializes, so a browser password manager sees a
 * real password field. Capture runs BEFORE React reads the FormData. If any
 * engine clears an input's value when its `type` changes, the first submit after
 * using the reveal toggle would carry an EMPTY or stale password while the field
 * still looks filled — and the retry (type already 'password', listener a no-op)
 * would succeed. That is exactly the reported shape, so it is worth a measurement
 * rather than an opinion.
 *
 * This is a MECHANISM test on a standalone page that reproduces the component's
 * behaviour, not a test of the app: it answers "does this browser lose the value
 * across a submit-time type flip?" and nothing else.
 *
 * KNOWN LIMIT, stated because the repo has been bitten by it before
 * (docs/lessons/mobile-overflow-is-a-safari-truncation-quirk.md): Playwright's
 * WebKit is NOT the owner's iOS Safari. A failure here is proof; a pass here is
 * NOT proof that his phone behaves the same way.
 *
 * Usage: node scripts/audit-probes/login-reveal-type-flip.mjs
 */
import { chromium, webkit } from 'playwright';

const PAGE = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<form id="f" onsubmit="return false">
  <input id="pw" type="password" name="password" value="">
  <button type="button" id="eye">reveal</button>
  <button type="submit" id="go">sign in</button>
</form>
<script>
  window.__result = null;
  const form = document.getElementById('f');
  const el = document.getElementById('pw');
  // The component's re-hide listener, verbatim in behaviour: capture phase, sets type.
  form.addEventListener('submit', () => { el.type = 'password'; }, true);
  document.getElementById('eye').addEventListener('click', () => {
    el.type = el.type === 'password' ? 'text' : 'password';
  });
  // Reader in the BUBBLE phase — i.e. after the capture flip, which is exactly
  // where React reads the FormData for a form action.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const sent = new FormData(form).get('password');
    window.__result = {
      sentLength: String(sent ?? '').length,
      domLength: el.value.length,
      type: el.type,
    };
  });
</script>`;

const PASSWORD = 'correct-horse-battery';

async function read(page) {
  await page.waitForFunction('window.__result !== null', null, { timeout: 5000 });
  return page.evaluate('window.__result');
}

async function run(name, browserType) {
  const browser = await browserType.launch();
  const page = await browser.newPage();
  await page.setContent(PAGE);

  const results = {};

  // Case A: type the password, submit WITHOUT ever revealing (the baseline).
  await page.fill('#pw', PASSWORD);
  await page.click('#go');
  results.withoutReveal = await read(page);

  // Case B: type, REVEAL (type -> text), then submit — the capture listener flips
  // the type back to 'password' while the field is being serialized.
  await page.setContent(PAGE);
  await page.fill('#pw', PASSWORD);
  await page.click('#eye');
  await page.click('#go');
  results.afterReveal = await read(page);

  // Case C: same as B but the field still has FOCUS when the flip happens, which
  // is the state a phone is actually in (tap reveal, tap sign in, keyboard up).
  await page.setContent(PAGE);
  await page.click('#pw');
  await page.type('#pw', PASSWORD);
  await page.click('#eye');
  await page.focus('#pw');
  await page.click('#go');
  results.afterRevealWhileFocused = await read(page);

  await browser.close();

  const expected = PASSWORD.length;
  console.log(`\n=== ${name} ===`);
  for (const [caseName, r] of Object.entries(results)) {
    const ok = r.sentLength === expected;
    console.log(
      `  ${ok ? 'OK  ' : 'LOSS'} ${caseName.padEnd(26)} sent=${r.sentLength} dom=${r.domLength} (expected ${expected}) type=${r.type}`,
    );
  }
  return Object.values(results).every((r) => r.sentLength === expected);
}

const chromiumOk = await run('chromium', chromium);
const webkitOk = await run('webkit (NOT iOS Safari)', webkit);

console.log(
  `\nVERDICT: ${chromiumOk && webkitOk ? 'no value loss in either engine — this mechanism is NOT reproduced here (inconclusive for real iOS Safari)' : 'VALUE LOSS REPRODUCED — the reveal toggle can send an empty password'}`,
);
