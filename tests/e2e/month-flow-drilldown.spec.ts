/**
 * "Every single bar … needs to be immediately available" (owner, 2026-08-01).
 *
 * The /reports income-vs-spending chart is the first thing on the page and had
 * no click handler at all: the category TABLE below it expanded, the chart above
 * it did not. This proves the shipped page — not a fixture — opens the rows
 * behind a bar and that they add up to the figure the bar was drawn from.
 *
 * The assertion is equality of PAINTED MONEY. A panel that opened but listed a
 * different set than the bar summed would be worse than no panel, and "the panel
 * is visible" would prove nothing about that.
 */
import { expect, test } from './helpers/test';
import { clickMoreNav } from './helpers/more-nav';

/** "$1,629.44" → 162944. Also handles a signed "−$1,629.44". */
function parseCents(text: string): number {
  const negative = /[-−]/.test(text);
  const digits = text.replace(/[^0-9.]/g, '');
  const value = Math.round(Number(digits) * 100);
  return negative ? -value : value;
}

async function openReports(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
  await clickMoreNav(page, 'nav-reports');
  await page.waitForURL('**/reports');
}

test('a month button opens spending rows that add up to the figure above them', async ({ page }) => {
  await openReports(page);

  const picker = page.getByTestId('month-flow-picker');
  await expect(picker).toBeVisible();

  // The most recent month the chart drew, taken from the DOM rather than
  // hardcoded — the demo's "today" moves and a pinned month would rot.
  const monthButtons = picker.locator('[data-testid^="month-flow-month-"]');
  const count = await monthButtons.count();
  expect(count).toBeGreaterThan(0); // anti-vacuity: the chart drew bars
  const last = monthButtons.nth(count - 1);
  const ym = (await last.getAttribute('data-testid'))!.replace('month-flow-month-', '');
  await last.click();

  const headline = page.getByTestId(`month-flow-headline-${ym}-expense`);
  await expect(headline).toBeVisible();
  const headlineCents = parseCents(await headline.innerText());
  expect(headlineCents).toBeGreaterThan(0); // a real figure, not an empty month

  // Open the spending panel for that month.
  await page.getByTestId(`month-flow-toggle-${ym}-expense`).click();
  const rows = page.getByTestId(`month-flow-rows-${ym}-expense`);
  await expect(rows).toBeVisible();

  const amounts = await rows.getByTestId('month-flow-row-amount').allInnerTexts();
  expect(amounts.length).toBeGreaterThan(0); // the hard case is present
  const summed = amounts.reduce((s, t) => s + parseCents(t), 0);
  expect(summed).toBe(headlineCents);

  // And the panel says so itself, in its own words.
  await expect(page.getByTestId(`month-flow-reconciled-${ym}-expense`)).toContainText('matched to the penny');
});

test('the panel states the FLOWS basis, not the category one', async ({ page }) => {
  await openReports(page);
  const monthButtons = page.locator('[data-testid^="month-flow-month-"]');
  const ym = (await monthButtons.last().getAttribute('data-testid'))!.replace('month-flow-month-', '');
  await monthButtons.last().click();
  await page.getByTestId(`month-flow-toggle-${ym}-expense`).click();

  const panel = page.getByTestId(`month-flow-panel-${ym}-expense`);
  // The sibling category panel says pending charges ARE counted. This chart is
  // posted-only, so inheriting that sentence would be a false claim about money.
  await expect(panel).toContainText('Posted spending only');
  await expect(panel).toContainText('still pending');
  await expect(panel).not.toContainText('the same way your reports and budgets count them');
});

test('the two bases on the page are reconciled by a sentence that names the gap', async ({ page }) => {
  // /reports prints ONE month's spending twice on two different rules: the chart
  // bar is posted-only, the "Spending by category" header counts pending too.
  // The drill-down is what invites the comparison, so the page has to own it.
  await openReports(page);

  const note = page.getByTestId('reports-basis-gap');
  await expect(note).toBeVisible(); // the demo has pending rows this month
  const noteText = await note.innerText();
  const stated = /the list below is (\$[\d,]+\.\d{2}) (higher|lower)/.exec(noteText);
  expect(stated, `basis note did not state a gap: ${noteText}`).not.toBeNull();
  const statedGap = parseCents(stated![1]);
  expect(statedGap).toBeGreaterThan(0); // anti-vacuity: a real difference

  // It must name no MECHANISM: at least five rules separate these two figures,
  // so blaming pending charges is false in both directions. Matched on the
  // PHRASE, not the word — "Spending by category" contains "pending", which is
  // how the first version of this assertion failed against correct copy.
  expect(noteText).not.toMatch(/pending charge/i);

  // Which month the sentence is ABOUT, taken from the sentence — so the two
  // figures compared below are provably the same month it names.
  const named = /For ([A-Za-z]+) (\d{4}) the list below/.exec(noteText);
  expect(named, `basis note did not name a month: ${noteText}`).not.toBeNull();
  // `formatMonth` renders "Jun 2026", so match on the three-letter stem rather
  // than assuming a full month name.
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const monthIndex = monthNames.findIndex((m) => m.startsWith(named![1].slice(0, 3)));
  expect(monthIndex).toBeGreaterThanOrEqual(0);
  const ym = `${named![2]}-${String(monthIndex + 1).padStart(2, '0')}`;

  // The category card's total for that month, as printed in its header. Read
  // from its own testid rather than a text pattern: the figure is the subject of
  // the assertion, so the locator must not be able to drift onto another number.
  const totalText = await page.getByTestId('reports-category-total').innerText();
  const categoryTotal = parseCents(totalText.slice(totalText.indexOf('$')));
  expect(categoryTotal).toBeGreaterThan(0);

  // The chart's own figure for the same month, via that month's panel headline.
  await page.getByTestId(`month-flow-month-${ym}`).click();
  const barCents = parseCents(await page.getByTestId(`month-flow-headline-${ym}-expense`).innerText());
  expect(barCents).toBeGreaterThan(0);

  // The sentence must describe THESE two numbers, not a third derivation.
  expect(statedGap).toBe(Math.abs(categoryTotal - barCents));
  // And the DIRECTION must match, which the magnitude alone cannot prove: the
  // gap can genuinely run either way (an income-category outflow puts the bar
  // above the list), and a sentence that always said "higher" would pass every
  // magnitude assertion while telling the reader the opposite of the truth.
  expect(stated![2]).toBe(categoryTotal > barCents ? 'higher' : 'lower');
});

test('clicking a bar on the chart opens that bar’s rows', async ({ page }) => {
  await openReports(page);
  await expect(page.getByTestId('income-expense-chart')).toBeVisible();

  // The rectangles Recharts paints for the spending series. Clicking one is the
  // gesture the owner asked for; the month buttons are the accessible path to
  // the same panel, so this test covers the accelerator specifically.
  const bars = page.locator('.recharts-bar-rectangle');
  await expect(bars.first()).toBeVisible();
  await bars.last().click();

  const panels = page.getByTestId('month-flow-panels');
  await expect(panels).toBeVisible();
  // Tapping a bar means "show me these" — the rows are open already, with no
  // second control to find.
  const openRows = panels.locator('[data-testid^="month-flow-rows-"]').first();
  await expect(openRows).toBeVisible();

  // ...and they must be the rows of the month that bar belongs to. Asserting
  // only that "a panel opened" would pass even if the datum carried the wrong
  // month, which is the single thing `month` is on the datum for.
  const openedTestId = (await openRows.getAttribute('data-testid'))!;
  const openedMonth = openedTestId.replace('month-flow-rows-', '').replace(/-(income|expense)$/, '');
  await expect(page.getByTestId(`month-flow-month-${openedMonth}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Re-tapping the SAME bar after collapsing must reopen it — the state is
  // otherwise unchanged, so nothing would remount and the chart's most obvious
  // control would go inert.
  await panels.locator('[data-testid^="month-flow-toggle-"]').first().click();
  await expect(openRows).toBeHidden();
  await bars.last().click();
  await expect(page.getByTestId(openedTestId)).toBeVisible();
});
