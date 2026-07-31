// READ-ONLY against PRODUCTION. Rule 5: "deployed" is not the push succeeding, and a
// 200 proves nothing. The O.17c marker lives on an auth-gated page, so curl cannot see
// it — this signs into the shared demo (one click, no credentials, no writes) and reads
// the Settings category manager.
//
// It NEVER clicks Remove. The whole point of the change is that the control is gone.
import { chromium } from '@playwright/test'

const BASE = 'https://www.aimplifi.app'
const browser = await chromium.launch()
const page = await browser.newPage()
let failures = 0
const check = (label, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++ }

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('demo-sign-in').click()
  await page.waitForURL('**/dashboard', { timeout: 30000 })
  console.log('signed into the shared demo on production\n')

  await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
  const manager = page.getByTestId('category-manager')
  await manager.waitFor({ timeout: 30000 })

  const text = (await manager.textContent()) ?? ''
  // Hard case present first, so the absence assertions cannot pass on an empty page.
  check('the category list rendered (contains "Car Wash")', text.includes('Car Wash'))

  check('NEW copy is live: "Removing is off in the demo"', text.includes('Removing is off in the demo'))
  check('NEW copy names the shared-row reason', text.includes('every other visitor'))
  check('OLD copy is gone: no "Remove the ones you don’t use"',
        !text.includes('Remove the ones you’t use') && !text.includes('Remove the ones you’re') &&
        !text.includes('Remove the ones you don’t use'))

  check('no Remove control for any category',
        (await page.getByTestId('cat-visibility-car-wash').count()) === 0)
  check('no Remove button by accessible name',
        (await manager.getByRole('button', { name: 'Remove' }).count()) === 0)
  check('rename control still fenced too (O.17)',
        (await page.getByTestId('cat-rename-car-wash').count()) === 0)
} finally {
  await browser.close()
}
console.log(failures === 0 ? '\nLIVE MARKER CONFIRMED on www.aimplifi.app' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
