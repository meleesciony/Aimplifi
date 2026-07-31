/**
 * O.13h — a receipt can be attached to a transaction, seen, and removed.
 *
 * WHY AN E2E AND NOT ONLY THE STORE TESTS. `attachment-store.test.ts` drives the
 * routes directly and proves ownership, the sniffed type and the deletion
 * cascade. It cannot see two things that only a real browser can answer, and both
 * are load-bearing claims this slice makes:
 *
 *  1. **That the preview actually paints.** The download route sends
 *     `Content-Disposition: attachment` for every file, and the whole reason the
 *     detail view still renders an `<img>` is that a SUBRESOURCE load ignores that
 *     header. That is a claim about browser behaviour, so it is asserted
 *     (`naturalWidth > 0`) rather than believed — if it were wrong, every reader
 *     would see a broken frame where their receipt should be.
 *  2. **That the control is on the page at all.** O.13b's scar: a banner that
 *     typechecked, built and passed 225 e2e tests while rendering nothing.
 *
 * A THROWAWAY USER, never the demo — the demo is one shared row and is deliberately
 * fenced out of uploading, so it could not run this flow even if the suite let it.
 */
import { expect, test, type Page } from './helpers/test';

/**
 * A real 1×1 PNG. It must be a VALID image, not just valid magic bytes: the
 * assertion below is that the browser decoded and painted it, which a truncated
 * header would fail.
 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function signUpThrowaway(page: Page) {
  const email = `e2e-o13h-${Date.now()}-${Math.floor(Math.random() * 1e6)}@aimplifi.test`;
  await page.goto('/sign-in');
  await page.getByTestId('auth-toggle').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('e2e-password-123');
  await page.getByTestId('auth-submit').click();
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

async function addManualAccount(page: Page, name: string) {
  await page.goto('/accounts');
  // The first click after a load can land pre-hydration and drop silently (#167).
  await expect(async () => {
    await page.getByTestId('add-asset-btn').click({ timeout: 2000 });
    await expect(page.getByTestId('manual-name')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('manual-name').fill(name);
  await page.getByTestId('manual-type').selectOption('CHECKING');
  await page.getByTestId('manual-value').fill('2500');
  await page.getByTestId('manual-submit').click();
  await expect(page.getByTestId('manual-account-row').filter({ hasText: name })).toBeVisible({
    timeout: 20000,
  });
}

async function addPurchase(page: Page, descriptor: string, amount: string) {
  await page.goto('/transactions/new');
  await expect(async () => {
    await page.getByTestId('txn-descriptor').fill(descriptor, { timeout: 2000 });
    await expect(page.getByTestId('txn-descriptor')).toHaveValue(descriptor, { timeout: 2000 });
  }).toPass({ timeout: 20000 });
  await page.getByTestId('txn-amount').fill(amount);
  await page.getByTestId('txn-submit').click();
  await page.waitForURL('**/transactions', { timeout: 20000 });
}

/** A reader standing on the detail view of a transaction he just entered. */
async function readerOnADetailPage(page: Page) {
  await signUpThrowaway(page);
  await addManualAccount(page, 'O13h Checking');
  await addPurchase(page, 'ZZQ VENDOR 8891 RECEIPTS', '64.10');
  await page.goto('/transactions');
  // The row's OWN detail link by testid, never `getByRole('link').first()` — the
  // first link in the row is the merchant filter, which lands back on the register.
  await page
    .getByTestId('txn-row')
    .filter({ hasText: 'Zzq' })
    .first()
    .getByTestId('txn-detail-link')
    .click();
  await page.waitForURL('**/transactions/**', { timeout: 20000 });
  // The panel is the fixture's hard case: without it every assertion below would
  // pass vacuously against a page that simply has no attachment section.
  await expect(page.getByTestId('detail-attachments')).toBeVisible({ timeout: 20000 });
}

test.describe('O.13h — receipts on a transaction', () => {
  test('a receipt can be attached, previewed and removed', async ({ page }) => {
    await readerOnADetailPage(page);

    // Nothing yet — asserted so the "it appeared" claim below means something.
    await expect(page.getByTestId('detail-attachments-empty')).toBeVisible();

    await page.getByTestId('detail-attachment-input').setInputFiles({
      name: 'costco receipt.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    await page.getByTestId('detail-attachment-save').click();

    const row = page.getByTestId('detail-attachment-row');
    await expect(row).toHaveCount(1, { timeout: 20000 });
    await expect(page.getByTestId('detail-attachment-link')).toHaveText('costco receipt.png');

    // THE CLAIM THIS TEST EXISTS FOR: the image really paints, even though its
    // response carries `Content-Disposition: attachment`. A broken image reports
    // naturalWidth 0.
    const preview = page.getByTestId('detail-attachment-preview');
    await expect(preview).toBeVisible();
    await expect
      .poll(async () => preview.evaluate((img) => (img as HTMLImageElement).naturalWidth), {
        timeout: 20000,
      })
      .toBeGreaterThan(0);

    // And the headers a reader never sees are the ones that matter most here.
    const href = await page.getByTestId('detail-attachment-link').getAttribute('href');
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['content-disposition']).toContain('attachment;');

    await page.getByTestId('detail-attachment-delete').click();
    await expect(page.getByTestId('detail-attachment-row')).toHaveCount(0, { timeout: 20000 });
    await expect(page.getByTestId('detail-attachments-empty')).toBeVisible();
  });

  test('a file the app does not store is refused, and says so', async ({ page }) => {
    await readerOnADetailPage(page);

    // An HTML document wearing an image name — the shape that would matter if the
    // stored type were ever taken from the filename or the client's declaration.
    await page.getByTestId('detail-attachment-input').setInputFiles({
      name: 'receipt.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<html><script>alert(1)</script></html>', 'utf8'),
    });
    await page.getByTestId('detail-attachment-save').click();

    // The refusal is shown to the reader verbatim, and nothing was stored.
    await expect(page.getByText(/nothing was saved/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('detail-attachment-row')).toHaveCount(0);
  });
});
