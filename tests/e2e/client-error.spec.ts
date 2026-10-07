/**
 * Client error reporting (DECISIONS #794): the route is reachable only with a
 * session, and the reporter is mounted on every page (a thrown error in the
 * browser produces one POST).
 */
import { expect, test } from './helpers/test';

test('anonymous POST is refused; a signed-in browser error reaches /api/client-error', async ({ page }) => {
  const anon = await page.request.post('/api/client-error', {
    data: { kind: 'error', message: 'x', route: '/', userAgent: 'test' },
  });
  expect(anon.status()).toBe(401);

  await page.goto('/');
  await page.getByTestId('demo-sign-in').click();
  await page.waitForURL('**/dashboard');

  const posted = page.waitForRequest((r) => r.url().endsWith('/api/client-error') && r.method() === 'POST');
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('e2e: deliberate client error');
    }, 0);
  });
  const req = await posted;
  const body = req.postDataJSON() as { kind: string; message: string; route: string };
  expect(body.kind).toBe('error');
  expect(body.message).toContain('deliberate client error');
  expect(body.route).toBe('/dashboard');
  const res = await req.response();
  expect(res?.status()).toBe(204);
});
