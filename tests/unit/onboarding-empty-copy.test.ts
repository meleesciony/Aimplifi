/**
 * Empty Home promised Cash-Needed in 30 seconds with zero navigation.
 * That is the bank-link + cards path. CSV is a first-class first-run path.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CONNECT_ONBOARDING_FOOTNOTE,
  EMPTY_DASHBOARD_DESCRIPTION,
} from '@/lib/copy/onboarding-empty-copy';

describe('Empty Home sells bank or CSV, not a 30-second Cash-Needed promise (DECISIONS #549)', () => {
  it('test_regression__empty_home_offers_csv_without_cash_needed_countdown', () => {
    expect(EMPTY_DASHBOARD_DESCRIPTION).toMatch(/paste a CSV/i);
    expect(EMPTY_DASHBOARD_DESCRIPTION).toMatch(/spending and net worth/i);
    expect(EMPTY_DASHBOARD_DESCRIPTION).not.toMatch(/exactly how much/i);
    expect(EMPTY_DASHBOARD_DESCRIPTION).not.toMatch(/savings rate/i);

    expect(CONNECT_ONBOARDING_FOOTNOTE).toMatch(/private/i);
    expect(CONNECT_ONBOARDING_FOOTNOTE).toMatch(/optional/i);
    expect(CONNECT_ONBOARDING_FOOTNOTE).not.toMatch(/30 seconds/);
    expect(CONNECT_ONBOARDING_FOOTNOTE).not.toMatch(/zero navigation/);
    expect(CONNECT_ONBOARDING_FOOTNOTE).not.toMatch(/Cash-Needed/);

    const dash = readFileSync(resolve('src/components/onboarding/empty-dashboard.tsx'), 'utf8');
    expect(dash).toContain('EMPTY_DASHBOARD_DESCRIPTION');

    const panel = readFileSync(resolve('src/components/onboarding/connect-onboarding-panel.tsx'), 'utf8');
    expect(panel).toContain('CONNECT_ONBOARDING_FOOTNOTE');
    expect(panel).toContain('onboard-import');
  });
});
