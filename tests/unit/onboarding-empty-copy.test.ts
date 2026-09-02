/**
 * Empty Home promised Cash-Needed in 30 seconds with zero navigation.
 * That is the bank-link + cards path. CSV is a first-class first-run path.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CONNECT_ONBOARDING_FOOTNOTE,
  CONNECT_ONBOARDING_HEADING,
  EMPTY_DASHBOARD_DESCRIPTION,
  GET_STARTED_DESCRIPTION,
  ONBOARDING_STEP_1_LABEL,
  SIGN_IN_DEMO_FOOTNOTE,
} from '@/lib/copy/onboarding-empty-copy';
import { INBOX_EMPTY_DESCRIPTION, INBOX_EMPTY_FOOTNOTE } from '@/lib/copy/inbox-copy';

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
    expect(panel).toContain('CONNECT_ONBOARDING_HEADING');
    expect(panel).toContain('onboard-import');
    expect(CONNECT_ONBOARDING_HEADING).toMatch(/paste a CSV/i);
    expect(CONNECT_ONBOARDING_HEADING).not.toMatch(/takes about a minute/);
  });
});

describe('Sign-in and first-run empty name CSV, not bank-only (DECISIONS #556)', () => {
  it('test_regression__sign_in_and_route_empty_offer_csv_not_bank_only', () => {
    expect(GET_STARTED_DESCRIPTION).toMatch(/paste a CSV/i);
    expect(GET_STARTED_DESCRIPTION).not.toMatch(/Connect an account to get started/);
    expect(SIGN_IN_DEMO_FOOTNOTE).toMatch(/paste a CSV/i);
    expect(SIGN_IN_DEMO_FOOTNOTE).not.toMatch(/connect your banks, cards, and brokerages/);

    const signIn = readFileSync(resolve('src/app/sign-in/page.tsx'), 'utf8');
    expect(signIn).toContain('SIGN_IN_DEMO_FOOTNOTE');
    expect(signIn).not.toMatch(/connect your banks, cards, and brokerages/);

    const empty = readFileSync(resolve('src/components/onboarding/route-empty.tsx'), 'utf8');
    expect(empty).toContain('GET_STARTED_DESCRIPTION');
    expect(empty).not.toMatch(/Connect an account to get started/);
    expect(empty).not.toMatch(/Add accounts first/);
    expect(empty).toMatch(/paste a CSV first/);
    expect(empty).toMatch(/connect a bank or paste a CSV, Coach fills in/i);
    expect(empty).not.toMatch(/add accounts manually/);

    expect(INBOX_EMPTY_DESCRIPTION).toMatch(/CSV is pasted/);
    expect(INBOX_EMPTY_DESCRIPTION).not.toMatch(/Once accounts are connected/);
    expect(INBOX_EMPTY_FOOTNOTE).toMatch(/paste a CSV/);
    expect(INBOX_EMPTY_FOOTNOTE).not.toMatch(/Connect once,/);
  });
});

describe('Home Step 1 names bank or CSV (DECISIONS #575)', () => {
  it('test_regression__home_step_1_names_bank_or_csv_not_bank_only', () => {
    expect(ONBOARDING_STEP_1_LABEL).toMatch(/paste a CSV/i);
    expect(ONBOARDING_STEP_1_LABEL).not.toMatch(/Connect your bank/);

    const steps = readFileSync(resolve('src/components/onboarding/step-indicator.tsx'), 'utf8');
    expect(steps).toContain('ONBOARDING_STEP_1_LABEL');
    expect(steps).not.toMatch(/Connect your bank/);
  });
});
