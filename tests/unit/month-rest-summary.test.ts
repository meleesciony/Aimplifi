import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MONTHLY_MONEY_REVIEW_LABEL,
  monthRestSummary,
  showsAutomationBlueprint,
  showsFulfillment,
  showsValueReceipts,
} from '@/lib/coach/month-rest-summary';

describe('monthRestSummary', () => {
  it('names only the claims that render', () => {
    expect(
      monthRestSummary({ automation: false, fulfillment: false, receipts: false }),
    ).toBe('Lifestyle creep, room for error, life-energy view, and Monthly Money Review');
    expect(
      monthRestSummary({ automation: true, fulfillment: false, receipts: false }),
    ).toBe(
      'Lifestyle creep, room for error, the automation blueprint, life-energy view, and Monthly Money Review',
    );
    expect(
      monthRestSummary({ automation: false, fulfillment: true, receipts: false }),
    ).toBe(
      'Lifestyle creep, room for error, life-energy view, life energy by category, and Monthly Money Review',
    );
    expect(
      monthRestSummary({ automation: false, fulfillment: false, receipts: true }),
    ).toBe(
      'Lifestyle creep, room for error, life-energy view, what Aimplifi caught, and Monthly Money Review',
    );
    expect(
      monthRestSummary({ automation: true, fulfillment: true, receipts: false }),
    ).toBe(
      'Lifestyle creep, room for error, the automation blueprint, life-energy view, life energy by category, and Monthly Money Review',
    );
    expect(
      monthRestSummary({ automation: true, fulfillment: false, receipts: true }),
    ).toBe(
      'Lifestyle creep, room for error, the automation blueprint, life-energy view, what Aimplifi caught, and Monthly Money Review',
    );
    expect(
      monthRestSummary({ automation: false, fulfillment: true, receipts: true }),
    ).toBe(
      'Lifestyle creep, room for error, life-energy view, life energy by category, what Aimplifi caught, and Monthly Money Review',
    );
    expect(
      monthRestSummary({ automation: true, fulfillment: true, receipts: true }),
    ).toBe(
      'Lifestyle creep, room for error, the automation blueprint, life-energy view, life energy by category, what Aimplifi caught, and Monthly Money Review',
    );
  });

  it('test_regression__month_rest_names_life_energy_view_not_the_hours_toggle', () => {
    for (const present of [
      { automation: false, fulfillment: false, receipts: false },
      { automation: true, fulfillment: true, receipts: true },
    ]) {
      const label = monthRestSummary(present);
      expect(label).toContain('life-energy view');
      expect(label).not.toMatch(/\bhours\b/);
    }
    expect(
      monthRestSummary({ automation: false, fulfillment: true, receipts: false }),
    ).toContain('life energy by category');
  });

  it('test_regression__month_rest_names_the_review_the_way_the_card_does', () => {
    expect(MONTHLY_MONEY_REVIEW_LABEL).toBe('Monthly Money Review');
    for (const present of [
      { automation: false, fulfillment: false, receipts: false },
      { automation: true, fulfillment: true, receipts: true },
    ]) {
      const label = monthRestSummary(present);
      expect(label.endsWith(`, and ${MONTHLY_MONEY_REVIEW_LABEL}`)).toBe(true);
      expect(label).not.toContain('the monthly review');
    }
    const page = readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8');
    expect(page).toContain('<CardDescription>{MONTHLY_MONEY_REVIEW_LABEL}</CardDescription>');
    expect(page).not.toContain('>Monthly Money Review<');
    expect(page).not.toContain('the monthly review');
  });

  it('test_regression__month_rest_presence_is_the_card_null_gate', () => {
    expect(showsAutomationBlueprint([])).toBe(false);
    expect(showsAutomationBlueprint([{}])).toBe(true);
    expect(showsFulfillment(null)).toBe(false);
    expect(showsFulfillment(undefined)).toBe(false);
    expect(showsFulfillment({})).toBe(true);
    expect(showsValueReceipts(0)).toBe(false);
    expect(showsValueReceipts(-1)).toBe(false);
    expect(showsValueReceipts(1)).toBe(true);

    const page = readFileSync(resolve('src/app/(app)/coach/page.tsx'), 'utf8');
    const blueprint = readFileSync(
      resolve('src/components/coach/automation-blueprint-card.tsx'),
      'utf8',
    );
    const fulfillment = readFileSync(resolve('src/components/coach/fulfillment-card.tsx'), 'utf8');
    expect(page).toContain('showsAutomationBlueprint(data.blueprint)');
    expect(page).toContain('showsFulfillment(data.fulfillment)');
    expect(page).toContain('showsValueReceipts(receipts.total)');
    expect(page).not.toContain('data.blueprint.length > 0');
    expect(page).not.toContain('data.fulfillment != null');
    expect(page).not.toContain('receipts.total > 0');
    expect(blueprint).toContain('if (!showsAutomationBlueprint(steps)) return null');
    expect(blueprint).not.toContain('steps.length === 0');
    expect(fulfillment).toContain('if (!showsFulfillment(curve)) return null');
    expect(fulfillment).not.toContain('curve == null');
  });
});
