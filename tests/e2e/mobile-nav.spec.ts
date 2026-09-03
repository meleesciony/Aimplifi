/**
 * Mobile More sheet (DECISIONS #187 / Gap 3 §2): labelled secondary destinations
 * replace the old 8 unlabeled top icons. Primary bottom tabs stay unchanged.
 *
 * Prefer mid-viewport / header clicks (nav-more) over fixed-bottom clicks for
 * new assertions — see docs/lessons/mobile-380-viewport-scaling-flake.md.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from './helpers/test';
import { clickMoreNav, openMoreNav } from './helpers/more-nav';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');
}

test('More sheet: opens labelled destinations, navigates, Escape closes', async ({ page }) => {
  await signIn(page);

  // Header is clean: More is visible; secondary links are NOT in the top bar.
  await expect(page.getByTestId('nav-more')).toBeVisible();
  await expect(page.getByTestId('nav-more')).toHaveText(/More/);
  await expect(page.getByTestId('nav-spending-plan')).toHaveCount(0);
  await expect(page.getByTestId('bottom-nav')).toBeVisible();

  await openMoreNav(page);
  const sheet = page.getByTestId('nav-more-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'More' })).toBeVisible();

  // Every secondary destination is labelled (icon + text), not icon-only.
  for (const id of [
    'nav-spending-plan',
    'nav-reports',
    'nav-accounts',
    'nav-investments',
    'nav-transactions',
    'nav-goals',
    'nav-budgets',
    // The rule builder was reachable only from a link inside the /transactions
    // header until the owner reported he could not find it at all.
    'nav-rules',
    'nav-settings',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  // Discover section surfaces dashboard-only routes.
  await expect(page.getByTestId('nav-ask')).toBeVisible();
  await expect(page.getByTestId('nav-trends')).toBeVisible();
  // A6 (2026-07-21 review): the AI Trust Center was reachable only from a card
  // inside /settings — it now sits with the other dashboard-adjacent surfaces.
  await expect(page.getByTestId('nav-trust')).toBeVisible();

  // WCAG AA on the open sheet.
  const axe = await new AxeBuilder({ page })
    .include('[data-testid="nav-more-sheet"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);

  // Escape closes and returns focus to the trigger.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('nav-more-sheet')).toHaveCount(0);
  await expect(page.getByTestId('nav-more')).toBeFocused();

  // Navigate via More → Plan.
  await clickMoreNav(page, 'nav-spending-plan');
  await page.waitForURL('**/spending-plan');
  await expect(page.getByTestId('spending-plan-hero')).toBeVisible();
  // Sheet closes on navigate.
  await expect(page.getByTestId('nav-more-sheet')).toHaveCount(0);
  // More stays highlighted while on a secondary route.
  await expect(page.getByTestId('nav-more')).toBeVisible();
});

/**
 * The More sheet after the legibility slice (owner, 2026-07-31: *"a lot of sections in the app
 * are cumbersome in daily workflow. You basically have to search it in a menu for it to show up.
 * A new user wouldn't have this knowledge."*).
 *
 * The unit suite proves the catalogue and the search predicate; it cannot see whether either
 * reaches the sheet. Everything here is about what a reader can actually read and type.
 */
test('More sheet: every row says what it is for, and search finds a page by the reader\'s word', async ({
  page,
}) => {
  await signIn(page);
  await openMoreNav(page);

  const sheet = page.getByTestId('nav-more-sheet');
  await expect(sheet).toBeVisible();

  // 1. DESCRIPTIONS. The four near-synonyms were the actual defect: "Plan" is /spending-plan and
  //    "Spending" is /budgets, while Reports and Trends are both charts of spending. A label
  //    alone cannot separate them, so each row carries the line that does.
  await expect(page.getByTestId('nav-spending-plan')).toContainText('guilt-free');
  await expect(page.getByTestId('nav-budgets')).toContainText('targets you set');
  await expect(page.getByTestId('nav-reports')).toContainText('trailing months');
  await expect(page.getByTestId('nav-trends')).toContainText('changed this month');

  // 2. SEARCH finds a page by a word that is in neither its label nor its description.
  const search = page.getByTestId('nav-more-search');
  await search.fill('subscriptions');
  await expect(page.getByTestId('nav-recurring')).toBeVisible();
  // ...and genuinely filters: the rest of the menu is gone, not merely deprioritised.
  await expect(page.getByTestId('nav-reports')).toHaveCount(0);
  await expect(page.getByTestId('nav-settings')).toHaveCount(0);

  // An ambiguous word returns BOTH pages it could mean rather than picking one for the reader.
  await search.fill('budget');
  await expect(page.getByTestId('nav-spending-plan')).toBeVisible();
  await expect(page.getByTestId('nav-budgets')).toBeVisible();

  // 3. NO MATCH is a state with its own words, not an empty menu.
  await search.fill('zzzzqqq');
  await expect(page.getByTestId('nav-more-empty')).toBeVisible();
  await expect(page.getByTestId('nav-more-empty')).toContainText('zzzzqqq');
  await expect(page.getByTestId('nav-transactions')).toHaveCount(0);

  // 4. Clearing the box restores the whole menu — the search is an accelerator over the list,
  //    never a gate in front of it.
  await search.fill('');
  await expect(page.getByTestId('nav-more-empty')).toHaveCount(0);
  for (const id of ['nav-spending-plan', 'nav-reports', 'nav-settings', 'nav-trust']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }

  // 5. WCAG AA on the sheet with the search control in it — the input needs its own label, and
  //    the rows are now two lines of text inside one anchor.
  const axe = await new AxeBuilder({ page })
    .include('[data-testid="nav-more-sheet"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations).toEqual([]);

  // 6. A filter must not survive the sheet closing: reopening to someone else's leftover query
  //    looks exactly like a menu that has lost items, which is the report this slice answers.
  await search.fill('trust');
  await expect(page.getByTestId('nav-settings')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('nav-more-sheet')).toHaveCount(0);
  await openMoreNav(page);
  await expect(page.getByTestId('nav-more-search')).toHaveValue('');
  await expect(page.getByTestId('nav-settings')).toBeVisible();

  // 7. And a searched-for row still navigates.
  await page.getByTestId('nav-more-search').fill('overdraft');
  await page.getByTestId('nav-forecast').click();
  await page.waitForURL('**/forecast');
});
