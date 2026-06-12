import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. The golden flows run on a 380×800 mobile viewport per
 * docs/PHASE_0_ARCHITECTURE.md §9. The web server uses the production build
 * (`next start`) against the seeded demo database.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-380',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 380, height: 800 },
      },
    },
  ],
  webServer: {
    command: 'npx next start -p 3100',
    url: 'http://localhost:3100/sign-in',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
