/**
 * U.1b — the compact register row, as a reader gets it (DECISIONS #779).
 *
 * The rest of the suite runs with every row forced open (`__AIMPLIFI_E2E_OPEN_ROWS`, set by
 * `helpers/test.ts`), because those specs predate the compact row and drive controls that
 * now sit behind its chevron. This spec is the collapse lock: it sets
 * `__AIMPLIFI_E2E_KEEP_ROWS_CLOSED` first, so it sees exactly what production renders.
 *
 * It runs on a REAL (signed-up) account with seeded rows, not the demo. That is the point:
 * the demo renders none of a real account's edit controls, which is how an audit run on the
 * demo ranked a two-rows-per-screen register twelfth. The demo gets one test at the end,
 * for the one thing only it has (an AI guess waiting for an OK).
 */
import AxeBuilder from '@axe-core/playwright';
import Database from 'better-sqlite3';
import type { Cookie } from '@playwright/test';
import { expect, test, type Locator, type Page } from './helpers/test';
import { E2E_DB_URL } from '../setup/test-db';
import { openActivityFilters } from './helpers/activity-filters';

const PASSWORD = 'e2e-password-123';

/** Everything a real row carries that the closed row hides, by test id. */
const REST = [
  'txn-merchant-link', // the "Filter" link beside an editable payee
  'txn-detail-link',
  'activity-descriptor',
  'txn-rule-link',
  'activity-note',
  'activity-tax',
  'activity-exclude',
  'activity-reimbursement',
  'txn-tax-trigger',
  'activity-direction',
  'txn-action-trigger',
] as const;

/** What stays on the closed row. */
const KEPT = [
  'txn-merchant-name',
  'category-chip',
  'activity-date',
  'activity-account',
  'activity-amount',
  'txn-spend-class',
  'txn-row-toggle',
] as const;

async function keepRowsClosed(page: Page) {
  await page.addInitScript(() => {
    (window as Window & { __AIMPLIFI_E2E_KEEP_ROWS_CLOSED?: boolean }).__AIMPLIFI_E2E_KEEP_ROWS_CLOSED = true;
  });
}

/**
 * Chromium absorbs a late layout change above the viewport with scroll anchoring; Safari
 * (the owner's phone) has none. Turned off, Chromium shows what Safari does.
 */
async function noScrollAnchoring(page: Page) {
  await page.addInitScript(() => {
    const apply = () => {
      if (!document.documentElement) return false;
      document.documentElement.style.overflowAnchor = 'none';
      return true;
    };
    if (!apply()) new MutationObserver((_, o) => apply() && o.disconnect()).observe(document, { childList: true });
  });
}

async function signUp(page: Page): Promise<string> {
  const email = `e2e-row-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  return email;
}

/**
 * One card and nine rows — enough to scroll. Dated inside the server's pinned "today"
 * (DEMO_TODAY=2026-06-10), newest first: a pending uncategorized charge, a pending
 * categorized one, five ordinary purchases, a paycheck, and a purchase whose category is
 * an AI guess still waiting for the reader's OK.
 */
function seedRows(email: string) {
  const db = new Database(E2E_DB_URL.replace(/^file:/, ''), {
    timeout: Number(process.env.SQLITE_BUSY_TIMEOUT_MS) || 15_000,
  });
  try {
    const user = db.prepare('SELECT id FROM User WHERE email = ?').get(email) as { id: string } | undefined;
    if (!user) throw new Error(`seedRows: user ${email} not found`);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const acct = `e2e-row-acct-${stamp}`;
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'CREDIT CARD', 'CREDIT', '4417', 50000, 'USD')`,
    ).run(acct, user.id, `ref-row-${stamp}`);
    // A second card with the kind of name a bank's feed really gives one (56 characters).
    // It holds no rows; it is there because every row's account picker lists it, and a
    // <select> is as wide as its longest option.
    db.prepare(
      `INSERT INTO Account (id, userId, provider, providerRef, name, type, mask, currentBalanceCents, currency)
       VALUES (?, ?, 'manual', ?, 'Sapphire Preferred Rewards Visa Signature Business Card', 'CREDIT', '9001', 0, 'USD')`,
    ).run(`e2e-row-acct2-${stamp}`, user.id, `ref-row2-${stamp}`);
    const txn = db.prepare(
      `INSERT INTO "Transaction" (id, accountId, date, amountCents, rawDescriptor, categoryId, status, isTransfer, isSplitParent)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    );
    const rows: Array<[string, number, string, string, string]> = [
      ['2026-06-09', -2755, 'GUSTO - CHASTAIN', 'uncategorized', 'PENDING'],
      ['2026-06-08', -2376, 'NORTHCREST GOLF', 'entertainment', 'PENDING'],
      ['2026-06-08', -696, 'CHICK-FIL-A #01234', 'fast-food', 'POSTED'],
      ['2026-06-07', -4318, 'AMAZON MKTPL*2K4', 'shopping', 'POSTED'],
      ['2026-06-06', -1899, 'E2E ROW BOOKSHOP', 'shopping', 'POSTED'],
      ['2026-06-05', -5210, 'E2E ROW GROCER', 'groceries', 'POSTED'],
      ['2026-06-04', -1275, 'E2E ROW CAFE', 'dining', 'POSTED'],
      ['2026-06-03', 250000, 'ACME PAYROLL', 'paycheck', 'POSTED'],
      ['2026-06-02', -3120, 'E2E ROW GUESS', 'dining', 'POSTED'],
    ];
    rows.forEach(([date, cents, descriptor, category, status], i) =>
      txn.run(`e2e-row-${i}-${stamp}`, acct, date, cents, descriptor, category, status),
    );
    // Two rows carrying a FACT the totals depend on: one excluded from them, one whose
    // payback is still awaited. Those chips are the register's honesty about the row and
    // must be on it whether it is open or not.
    db.prepare('UPDATE "Transaction" SET excludeFromTotals = 1 WHERE id = ?').run(`e2e-row-4-${stamp}`);
    // …and that one also carries a note: something the reader wrote on the row.
    db.prepare(`UPDATE "Transaction" SET reimbursement = 'awaiting', note = 'Prescription for mum, the long one' WHERE id = ?`).run(
      `e2e-row-6-${stamp}`,
    );
    // The one origin that asks for something: the category came from the model
    // (`source = 'llm'`) and nobody has confirmed it. Seeded here, on this spec's own
    // account — the demo has such a row too, but `why-this-category.spec.ts` confirms it,
    // and a test that reads another spec's leftovers fails whenever it runs second.
    db.prepare(
      `INSERT INTO CategoryPrediction (id, userId, transactionId, predictedCategoryId, confidenceBps, source, createdAt)
       VALUES (?, ?, ?, 'dining', 6200, 'llm', CURRENT_TIMESTAMP)`,
    ).run(`e2e-row-pred-${stamp}`, user.id, `e2e-row-8-${stamp}`);
    return { ids: rows.map((_, i) => `e2e-row-${i}-${stamp}`) };
  } finally {
    db.close();
  }
}

const rowsOf = (page: Page) => page.getByTestId('txn-row');

async function heights(rows: Locator): Promise<number[]> {
  return rows.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
}

async function overflowX(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** How much of the row's content column (everything right of the chevron) a field spans. */
async function fieldShare(row: Locator, testId: string): Promise<number> {
  return row.evaluate((li, id) => {
    const field = li.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
    const toggle = li.querySelector('[data-testid="txn-row-toggle"]')!.getBoundingClientRect();
    const rowBox = li.getBoundingClientRect();
    return field.width / (rowBox.right - toggle.right);
  }, testId);
}

async function axe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(results.violations.map((v) => v.id), `axe violations: ${label}`).toEqual([]);
}

test.describe('U.1b — the compact register row on a real account', () => {
  test.describe.configure({ mode: 'serial' });
  let email = '';
  let ids: string[] = [];

  /**
   * The session the first test signed up with, handed to each later test's fresh context.
   * Not a form sign-in per test: ten of those per engine, two engines at once, sits at the
   * app's own limit of 20 sign-in attempts a minute per device, and every other spec in a
   * full run signs in from the same address.
   */
  let session: Cookie[] = [];
  async function signIn(page: Page) {
    expect(session.length, 'the first test signs up and keeps the session').toBeGreaterThan(0);
    await page.context().addCookies(session);
  }

  test('closed rows are compact: a screen holds six or more, where it held two', async ({ page }) => {
    await keepRowsClosed(page);
    email = await signUp(page);
    ({ ids } = seedRows(email));
    session = await page.context().cookies();

    await page.goto('/transactions');
    await expect(rowsOf(page)).toHaveCount(9);
    const hs = await heights(rowsOf(page));
    // Measured before U.1b on this same fixture: 300–350px a row. The tallest closed row is
    // one carrying an out-of-scope class control (a 44px button) under a wrapped payee.
    for (const h of hs) expect(h, `row heights ${JSON.stringify(hs)}`).toBeLessThanOrEqual(140);
    const mean = hs.reduce((s, h) => s + h, 0) / hs.length;
    expect(mean, `mean of ${JSON.stringify(hs)}`).toBeLessThanOrEqual(110);
    // The claim in the title, in the viewport's own terms.
    const viewport = page.viewportSize()!.height;
    expect(viewport / mean).toBeGreaterThanOrEqual(6);
    expect(await overflowX(page)).toBeLessThanOrEqual(1);
  });

  test('a closed row keeps what a reader scans for, and holds the rest behind the chevron', async ({ page }) => {
    await keepRowsClosed(page);
    await signIn(page);
    await page.goto('/transactions');

    const row = rowsOf(page).filter({ hasText: 'Chick-fil-A' }).first();
    await expect(row).toHaveAttribute('data-open', 'false');
    for (const id of KEPT) await expect(row.getByTestId(id), `kept: ${id}`).toBeVisible();
    for (const id of REST) await expect(row.getByTestId(id), `rest: ${id}`).toBeHidden();
    // Hidden, not removed: the controls are mounted, so opening the row shows the very
    // elements that were there, and desktop never lost them.
    for (const id of REST) await expect(row.getByTestId(id), `mounted: ${id}`).toHaveCount(1);

    // The page lead says "Each row is labeled Fixed or Discretionary" — true of a closed row.
    await expect(row.getByTestId('txn-spend-class')).toHaveText(/Discretionary|Fixed/);
    // A fact about the row stays on it, closed: still pending; left out of the totals
    // above; a payback not yet received. (The register's totals are only honest while the
    // rows that explain them say so without being opened.)
    await expect(rowsOf(page).filter({ hasText: 'Gusto' }).first().getByText('Pending', { exact: true })).toBeVisible();
    const excluded = rowsOf(page).filter({ hasText: 'E2E Row Bookshop' }).first();
    await expect(excluded).toHaveAttribute('data-open', 'false');
    await expect(excluded.getByTestId('txn-excluded-badge')).toBeVisible();
    const awaited = rowsOf(page).filter({ hasText: 'E2E Row Cafe' }).first();
    await expect(awaited).toHaveAttribute('data-open', 'false');
    await expect(awaited.getByTestId('txn-reimb-badge')).toBeVisible();
    // A note is the reader's own fact about the row: its control stays on the closed row
    // when there is one to show ("Note"), and waits for the open when there is nothing.
    await expect(awaited.getByTestId('txn-tax-trigger')).toBeVisible();
    await expect(awaited.getByTestId('txn-tax-trigger')).toHaveText('Note');
    await expect(row.getByTestId('txn-tax-trigger')).toBeHidden();

    // The chevron is the way in: a real button, 44px square, that says what it does —
    // and it comes FIRST in the row, on screen and in the tab order, like the triangle
    // on every other disclosure in the app.
    const toggle = row.getByTestId('txn-row-toggle');
    expect((await toggle.boundingBox())!.x).toBeLessThan((await row.getByTestId('txn-merchant-name').boundingBox())!.x);
    expect(
      await row.evaluate((li) => li.querySelector('button, a, input, select, [tabindex]')?.getAttribute('data-testid')),
    ).toBe('txn-row-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-label', /^Show all controls for this Chick-fil-A transaction$/);
    const box = (await toggle.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    await axe(page, 'register, rows closed');
  });

  test('opening a row shows every control in place, and only that row opens', async ({ page }) => {
    await keepRowsClosed(page);
    await signIn(page);
    await page.goto('/transactions');

    const row = rowsOf(page).filter({ hasText: 'Chick-fil-A' }).first();
    const other = rowsOf(page).filter({ hasText: 'Amazon' }).first();
    const before = (await heights(row))[0];
    await row.getByTestId('txn-row-toggle').click();

    await expect(row).toHaveAttribute('data-open', 'true');
    await expect(row.getByTestId('txn-row-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(row.getByTestId('txn-row-toggle')).toHaveAttribute('aria-label', /^Hide all controls/);
    for (const id of [...KEPT, ...REST]) await expect(row.getByTestId(id), `open: ${id}`).toBeVisible();
    expect((await heights(row))[0]).toBeGreaterThan(before);

    await expect(other).toHaveAttribute('data-open', 'false');
    await expect(other.getByTestId('txn-detail-link')).toBeHidden();
    expect(await overflowX(page)).toBeLessThanOrEqual(1);
    await axe(page, 'register, one row open');

    // The opened row gives its controls the row's width, not what is left beside the
    // amount. That is the difference between this layout and the one it replaced, where
    // they wrapped in a ~100–150px column: the slice's first cut put the chevron in that
    // column too and made an open row 15–20% TALLER than before (critic cycle 1, measured).
    const widths = await row.evaluate((li) => {
      const line = li.querySelector('[data-testid="txn-detail-link"]')!.parentElement!;
      return { line: line.getBoundingClientRect().width, row: li.getBoundingClientRect().width };
    });
    expect(widths.line / widths.row, JSON.stringify(widths)).toBeGreaterThan(0.7);
    // Before U.1b this row stood 279–302px on this fixture. Opened, it is shorter than that.
    expect((await heights(row))[0]).toBeLessThan(270);

    // Keyboard: the trigger precedes what it discloses, so Tab from the chevron stays in
    // the row it opened.
    await row.getByTestId('txn-row-toggle').focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="txn-row"]')?.id)).toBe(
      await row.getAttribute('id'),
    );

    // A row with one of its own panels up cannot be closed out from under it: the chevron
    // closes the menu along with the row.
    await row.getByTestId('txn-action-trigger').click();
    await expect(row.getByTestId('txn-action-menu')).toBeVisible();
    await row.getByTestId('txn-row-toggle').click();
    await expect(row).toHaveAttribute('data-open', 'false');
    await expect(row.getByTestId('txn-action-menu')).toHaveCount(0);
    await row.getByTestId('txn-row-toggle').click();
    await expect(row).toHaveAttribute('data-open', 'true');

    // The controls it revealed are this row's own: Details points at this row's page.
    // (Asserted on the href, not by navigating — a click-then-navigate on this page is a
    // known flake under load, in both engines, and the claim here is which row it is for.)
    const href = (await row.getByTestId('txn-detail-link').getAttribute('href')) ?? '';
    expect(href.split('?')[0]).toBe(`/transactions/${ids[2]}`);
  });

  test('a panel opened from a closed row opens the row for good — the next tap lands', async ({ page }) => {
    await keepRowsClosed(page);
    await signIn(page);
    await page.goto('/transactions');

    // The note row keeps its note control closed (it has something to say). Opening that
    // control's panel opens the ROW — in the remembered set, not just while the panel is up.
    const row = rowsOf(page).filter({ hasText: 'E2E Row Cafe' }).first();
    await expect(row).toHaveAttribute('data-open', 'false');
    await row.getByTestId('txn-tax-trigger').click();
    const panel = row.getByTestId('txn-tax-panel');
    await expect(panel).toBeVisible();
    await expect(row).toHaveAttribute('data-open', 'true');
    // Both pickers open from the row's left edge and stay inside the viewport — the
    // content column starts 52px in, and a 288px panel starting there would not fit a
    // 360px phone.
    const vw = page.viewportSize()!.width;
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vw);

    // The tap that used to be lost (critic cycle 2, F2): with the panel up, press a control
    // the open revealed. The press outside the panel dismisses it — and when "open" was
    // borrowed from the panel, that closed the row and hid the control before the tap landed.
    await row.getByTestId('activity-descriptor').click();
    await expect(panel).toHaveCount(0);
    await expect(row).toHaveAttribute('data-open', 'true');
    await expect(row.getByTestId('txn-descriptor-form')).toBeVisible();
    // …and it is remembered like any other opened row.
    await page.reload();
    await expect(row).toHaveAttribute('data-open', 'true');
    await row.getByTestId('txn-row-toggle').click();
    await expect(row).toHaveAttribute('data-open', 'false');

    // The category picker lives on the closed row and does not open it.
    const other = rowsOf(page).filter({ hasText: 'E2E Row Grocer' }).first();
    await other.getByTestId('category-chip').click();
    const menu = (await other.getByTestId('category-menu').boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(vw);
    await expect(other).toHaveAttribute('data-open', 'false');
    expect(await overflowX(page)).toBeLessThanOrEqual(1);
  });

  test('an opened row stays inside the screen: a long note, the note editor, the amount editor', async ({ page }) => {
    await keepRowsClosed(page);
    await signIn(page);
    await page.goto('/transactions');
    const project = page.viewportSize()!;

    // The Cafe row's note is 34 characters. Its Note / Tax tag / Exclude / Reimburse group
    // was one unbreakable box, and on a row like this it left the screen by 57–105px
    // (critic cycle 2, F1) — invisible to a fixture whose only note was 15 characters.
    const row = rowsOf(page).filter({ hasText: 'E2E Row Cafe' }).first();
    await row.getByTestId('txn-row-toggle').click();
    await expect(row.getByTestId('activity-note')).toBeVisible();
    for (const width of [360, project.width, 430]) {
      await page.setViewportSize({ width, height: project.height });
      expect(await overflowX(page), `long note, idle, at ${width}px`).toBeLessThanOrEqual(1);
    }
    await row.getByTestId('activity-note').click();
    await expect(row.getByTestId('txn-note-form')).toBeVisible();
    for (const width of [360, project.width, 430]) {
      await page.setViewportSize({ width, height: project.height });
      expect(await overflowX(page), `note editor open, at ${width}px`).toBeLessThanOrEqual(1);
      // "Inside the screen" is not enough: sharing a line with Save / Clear / Cancel, the
      // text box was 53px wide at 360px — four characters a line (critic cycle 4, F1).
      // It has a line to itself, as wide as the row's content column.
      expect(await fieldShare(row, 'txn-note-input'), `note box width at ${width}px`).toBeGreaterThan(0.6);
    }
    await row.getByRole('button', { name: 'Cancel' }).click();
    await page.setViewportSize(project);

    // Editing the amount: the editor takes a line of its own. In the row's third column it
    // took the whole row — the payee ended up under the input and the Money in/out flip
    // outside the card (critic cycle 2, F3).
    const other = rowsOf(page).filter({ hasText: 'E2E Row Grocer' }).first();
    await other.getByTestId('txn-row-toggle').click();
    await other.getByTestId('activity-amount').click();
    await expect(other.getByTestId('txn-amount-form')).toBeVisible();
    for (const width of [360, project.width, 430]) {
      await page.setViewportSize({ width, height: project.height });
      const rects = await other.evaluate((li) => {
        const r = (sel: string) => {
          const b = li.querySelector(sel)!.getBoundingClientRect();
          return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
        };
        const b = li.getBoundingClientRect();
        return {
          row: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
          payee: r('[data-testid="txn-merchant-name"]'),
          form: r('[data-testid="txn-amount-form"]'),
          flip: r('[data-testid="activity-direction"]'),
        };
      });
      const inside = (a: typeof rects.row) =>
        a.left >= rects.row.left - 1 && a.right <= rects.row.right + 1 && a.top >= rects.row.top - 1 && a.bottom <= rects.row.bottom + 1;
      expect(inside(rects.form), `editor inside the row at ${width}px ${JSON.stringify(rects)}`).toBe(true);
      expect(inside(rects.flip), `flip inside the row at ${width}px ${JSON.stringify(rects)}`).toBe(true);
      // The payee keeps a readable width and the editor does not sit on top of it.
      expect(rects.payee.right - rects.payee.left, `payee width at ${width}px`).toBeGreaterThan(60);
      expect(rects.form.top >= rects.payee.bottom - 1 || rects.form.left >= rects.payee.right - 1).toBe(true);
      expect(await overflowX(page), `amount editor open, at ${width}px`).toBeLessThanOrEqual(1);
    }
  });

  test('the Bank text and account editors stay inside the screen, with a 56-character account name', async ({ page }) => {
    await keepRowsClosed(page);
    await signIn(page);
    await page.goto('/transactions');
    const project = page.viewportSize()!;
    const row = rowsOf(page).filter({ hasText: 'Chick-fil-A' }).first();
    await row.getByTestId('txn-row-toggle').click();

    /** The Save button of an editor is inside the row and the page does not scroll sideways. */
    const fits = async (saveId: string, what: string) => {
      for (const width of [360, project.width, 430]) {
        await page.setViewportSize({ width, height: project.height });
        const [rowBox, save] = await Promise.all([row.boundingBox(), row.getByTestId(saveId).boundingBox()]);
        expect(save!.x + save!.width, `${what}: Save inside the row at ${width}px`).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
        expect(await overflowX(page), `${what} open, at ${width}px`).toBeLessThanOrEqual(1);
      }
      await page.setViewportSize(project);
    };

    // "Bank text": its wrapper was a `shrink-0` item holding a form, so the form sat at its
    // full natural width and Save and Cancel were off the screen — by 56–125px, on every row,
    // in both engines (critic cycle 3, F1).
    await row.getByTestId('activity-descriptor').click();
    await expect(row.getByTestId('txn-descriptor-form')).toBeVisible();
    await fits('txn-descriptor-save', 'Bank text editor');
    // …and the text being edited has a line to itself, not what Save and Cancel leave.
    expect(await fieldShare(row, 'txn-descriptor-input')).toBeGreaterThan(0.6);
    await row.getByRole('button', { name: 'Cancel' }).click();

    // The account picker is as wide as its longest option. With the long-named card on the
    // account it was 463–469px on every row (critic cycle 3, F2).
    await row.getByTestId('activity-account').click();
    await expect(row.getByTestId('txn-account-form')).toBeVisible();
    await fits('txn-account-save', 'account editor');
    // …and with the long name as the one SELECTED. Safari clamps the box either way, but
    // under its default white-space: pre the selected name still widened the page — by
    // 89–159px, with every element inside the row (found by the maker's own sweep).
    await row
      .getByTestId('txn-account-select')
      .selectOption({ label: 'Sapphire Preferred Rewards Visa Signature Business Card' });
    await fits('txn-account-save', 'account editor, long name selected');
    const select = (await row.getByTestId('txn-account-select').boundingBox())!;
    expect(select.x + select.width).toBeLessThanOrEqual(project.width);
    await row.getByRole('button', { name: 'Cancel' }).click();

    // The payee's rename box: it lives inside the payee's truncating span, which cut its
    // right edge off by 10–82px (critic cycle 4). Whole, and inside the row, at each width.
    // (By id from here: the row is found by its payee's text, which the editor replaces.)
    const byId = page.locator('[id="' + (await row.getAttribute('id')) + '"]');
    await byId.getByTestId('payee-row-name').click();
    await expect(byId.getByTestId('payee-rename-form')).toBeVisible();
    for (const width of [360, project.width, 430]) {
      await page.setViewportSize({ width, height: project.height });
      const seen = await byId.evaluate((li) => {
        const input = li.querySelector('[data-testid="payee-rename-form"] input')!.getBoundingClientRect();
        // What is actually painted at the input's right edge: the input itself, or nothing of it?
        const at = document.elementFromPoint(input.right - 3, input.top + input.height / 2);
        return { width: input.width, right: input.right, rowRight: li.getBoundingClientRect().right, hit: at?.tagName ?? null };
      });
      expect(seen.hit, `payee box right edge painted at ${width}px ${JSON.stringify(seen)}`).toBe('INPUT');
      expect(seen.right, `payee box inside the row at ${width}px`).toBeLessThanOrEqual(seen.rowRight + 1);
      expect(seen.width, `payee box width at ${width}px`).toBeGreaterThanOrEqual(120);
      expect(await overflowX(page), `payee editor open, at ${width}px`).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize(project);
    await byId.getByTestId('payee-rename-form').getByRole('button', { name: 'Cancel' }).click();

    // The same name is an option in the filter bar's account dropdown — and, chosen
    // there, it is the selected one (227–262px of sideways scroll in WebKit before the
    // base `select` rule).
    await openActivityFilters(page);
    for (const width of [360, project.width, 430]) {
      await page.setViewportSize({ width, height: project.height });
      expect(await overflowX(page), `Filters open, at ${width}px`).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize(project);
    await page
      .getByTestId('txn-filter-account')
      .selectOption({ label: 'Sapphire Preferred Rewards Visa Signature Business Card' });
    await page.waitForURL(/account=/);
    await expect(page.getByTestId('txn-filters-toggle')).toHaveAttribute('aria-expanded', 'true');
    for (const width of [360, project.width, 430]) {
      await page.setViewportSize({ width, height: project.height });
      expect(await overflowX(page), `filtered to the long-named account, at ${width}px`).toBeLessThanOrEqual(1);
    }
  });

  test('every opened row is shorter than the row it replaced', async ({ page }) => {
    await keepRowsClosed(page);
    await signIn(page);
    await page.goto('/transactions');
    await expect(rowsOf(page)).toHaveCount(9);

    // The first eight: the rows there is a pre-slice measurement for.
    const toggles = page.getByTestId('txn-row-toggle');
    for (let i = 0; i < 8; i++) await toggles.nth(i).click();
    for (let i = 0; i < 8; i++) await expect(rowsOf(page).nth(i)).toHaveAttribute('data-open', 'true');
    const hs = (await heights(rowsOf(page))).slice(0, 8);
    // The same eight rows at the commit before U.1b (ca40f713), same engines, same touch
    // profile, measured 2026-10-02: 380px [353,345,302,302,349,302,328,352], iPhone 13
    // [353,345,279,299,328,302,328,302]. The shortest of those is 279, and seven of the
    // eight rows open under it. The eighth carries a 34-character note, whose controls
    // need a second line; it is held to its own pre-slice height.
    hs.forEach((h, i) => {
      if (i === 6) expect(h, `long-note row, of ${JSON.stringify(hs)}`).toBeLessThanOrEqual(328);
      else expect(h, `row ${i} of ${JSON.stringify(hs)}`).toBeLessThan(279);
    });
    expect(await overflowX(page)).toBeLessThanOrEqual(1);
  });

  test('an opened row is still open after the reload every edit ends in — and closing sticks too', async ({ page }) => {
    await keepRowsClosed(page);
    await signIn(page);
    await page.goto('/transactions');

    const row = rowsOf(page).filter({ hasText: 'Amazon' }).first();
    await row.getByTestId('txn-row-toggle').click();
    await expect(row).toHaveAttribute('data-open', 'true');

    await page.reload();
    await expect(row).toHaveAttribute('data-open', 'true');
    await expect(row.getByTestId('txn-action-trigger')).toBeVisible();
    await expect(rowsOf(page).filter({ hasText: 'Chick-fil-A' }).first()).toHaveAttribute('data-open', 'false');

    await row.getByTestId('txn-row-toggle').click();
    await expect(row).toHaveAttribute('data-open', 'false');
    await page.reload();
    await expect(row).toHaveAttribute('data-open', 'false');
    await expect(row.getByTestId('txn-action-trigger')).toBeHidden();
  });

  test('saving a note in an opened row: the row is still open and the reader has not moved', async ({ page }) => {
    // The path a reader actually takes, end to end — no storage key written by hand. Every
    // row editor (note, tax tag, amount, date, account, bank text, payee, direction, exclude,
    // reimbursement) used to confirm with a bare reload, which saved no scroll position: the
    // row came back open and the reader came back somewhere else — 3,300px away in Chromium
    // (critic cycle 3, F3).
    await keepRowsClosed(page);
    await noScrollAnchoring(page);
    await signIn(page);
    await page.goto('/transactions');

    for (const name of ['Gusto', 'Northcrest', 'Chick-fil-A', 'Amazon', 'E2E Row Bookshop']) {
      await rowsOf(page).filter({ hasText: name }).first().getByTestId('txn-row-toggle').click();
    }
    const row = rowsOf(page).filter({ hasText: 'Acme Payroll' }).first();
    await row.getByTestId('txn-row-toggle').click();
    await row.evaluate((el) => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 120 }));
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(600);

    await row.getByTestId('activity-note').click();
    await row.getByTestId('txn-note-input').fill('October pay');
    const topBefore = await row.evaluate((el) => Math.round(el.getBoundingClientRect().top));
    await row.getByTestId('txn-note-save').click();

    // The reload happened and the write is on the row…
    await expect(row.getByTestId('activity-note')).toHaveText('October pay', { timeout: 20_000 });
    // …the row is still open…
    await expect(row).toHaveAttribute('data-open', 'true');
    // …and it is where it was when Save was pressed.
    await expect
      .poll(() => row.evaluate((el) => Math.round(el.getBoundingClientRect().top)), { timeout: 10_000 })
      .toBe(topBefore);
  });

  test('rows reopened by a reload are open BEFORE the reader is scrolled back to their place', async ({ page }) => {
    // Chromium absorbs a late layout change above the viewport with scroll anchoring; Safari
    // (the owner's phone) does not. Turn anchoring off so this test sees what Safari does: if
    // the rows reopened AFTER the saved offset was restored, everything below them would be
    // pushed down and the row the reader was working in would move.
    await keepRowsClosed(page);
    await noScrollAnchoring(page);
    await signIn(page);
    await page.goto('/transactions');

    // Open the first three rows, then stand on a row well below them.
    for (const name of ['Gusto', 'Northcrest', 'Chick-fil-A']) {
      await rowsOf(page).filter({ hasText: name }).first().getByTestId('txn-row-toggle').click();
    }
    const anchor = rowsOf(page).filter({ hasText: 'E2E Row Grocer' }).first();
    await anchor.evaluate((el) => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 120 }));
    const y = await page.evaluate(() => Math.round(window.scrollY));
    expect(y).toBeGreaterThan(300); // the three open rows are above the viewport
    const topBefore = await anchor.evaluate((el) => Math.round(el.getBoundingClientRect().top));

    // What `reloadPreservingScroll` writes immediately before every edit's reload.
    await page.evaluate((savedY) => {
      sessionStorage.setItem(
        'aimplifi:register-scroll',
        JSON.stringify({ y: savedY, at: Date.now(), view: window.location.pathname + window.location.search }),
      );
    }, y);
    await page.reload();

    await expect(rowsOf(page).filter({ hasText: 'Gusto' }).first()).toHaveAttribute('data-open', 'true');
    await expect
      .poll(() => anchor.evaluate((el) => Math.round(el.getBoundingClientRect().top)), { timeout: 10_000 })
      .toBe(topBefore);
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(y);
  });

  test('a row that asks for something keeps its ask on the closed row', async ({ page }) => {
    await keepRowsClosed(page);
    await signIn(page);
    await page.goto('/transactions');

    const guess = rowsOf(page).filter({ hasText: 'E2E Row Guess' }).first();
    await expect(guess).toHaveAttribute('data-open', 'false');
    await expect(guess.getByTestId('txn-provenance')).toBeVisible();
    await expect(guess.getByTestId('txn-provenance')).toContainText('needs your OK');
    await expect(guess.getByTestId('provenance-confirm')).toBeVisible();
    // …while a badge that only reports how the category was reached waits for the open.
    const other = rowsOf(page).filter({ hasText: 'Chick-fil-A' }).first();
    await expect(other.getByTestId('txn-provenance')).toBeHidden();
    expect(await overflowX(page)).toBeLessThanOrEqual(1);
  });

  test('from sm up there is no chevron and nothing is hidden', async ({ page }) => {
    await keepRowsClosed(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    await page.goto('/transactions');

    const row = rowsOf(page).filter({ hasText: 'Chick-fil-A' }).first();
    await expect(row.getByTestId('txn-row-toggle')).toBeHidden();
    for (const id of [...KEPT.filter((k) => k !== 'txn-row-toggle'), ...REST]) {
      await expect(row.getByTestId(id), `desktop: ${id}`).toBeVisible();
    }
  });
});

test('the demo: a badge that only reports waits for the open; the payee link stays', async ({ page }) => {
  await keepRowsClosed(page);
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await page.goto('/transactions');

  // A badge that only reports how the category was reached waits for the open.
  const settled = rowsOf(page).filter({ hasText: 'Known merchant' }).first();
  await expect(settled).toHaveAttribute('data-open', 'false');
  await expect(settled.getByTestId('txn-provenance')).toBeHidden();
  await expect(settled.getByTestId('txn-detail-link')).toBeHidden();
  // On the demo the payee itself is the merchant link, and it stays.
  await expect(settled.getByTestId('txn-merchant-link')).toBeVisible();
  await settled.getByTestId('txn-row-toggle').click();
  await expect(settled.getByTestId('txn-provenance')).toBeVisible();
  await expect(settled.getByTestId('txn-detail-link')).toBeVisible();
});
