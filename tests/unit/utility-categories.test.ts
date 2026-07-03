/**
 * #154 — household utility split. `utilities` ("Internet & Utilities") was a
 * single catch-all; it now has four sibling leaves (Electricity, Natural Gas,
 * Water & Sewer, Trash & Recycling) so a real bank feed files each bill
 * specifically. This locks:
 *   1. the taxonomy is present, additive, and hideable (redundant-category
 *      removal is served by the existing hide feature, DECISIONS #110);
 *   2. generic + e-payment routing splits by SERVICE word, gas-before-electricity
 *      so a gas biller that says "ENERGY"/"LIGHT" files as gas;
 *   3. NON-regression: gasoline (`fuel`), Xfinity (`utilities`), and card
 *      e-payments (`transfer`) are untouched — so every money golden holds.
 */
import { describe, expect, it } from 'vitest';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { ASSIGNABLE_CATEGORIES } from '@/lib/engine/categorize/assign';
import { categoryCatalog, isHideable } from '@/lib/engine/categorize/visibility';

const NEW_LEAVES = ['electricity', 'natural-gas', 'water', 'trash'] as const;

describe('#154 taxonomy: four additive utility leaves', () => {
  it.each(NEW_LEAVES)('"%s" is a Bills & Utilities need, assignable and hideable', (id) => {
    const meta = CATEGORY_BY_ID.get(id);
    expect(meta, id).toBeDefined();
    expect(meta!.group).toBe('Bills & Utilities');
    expect(meta!.discretionary).toBe(false); // a bill is a "need", not lifestyle creep
    expect(ASSIGNABLE_CATEGORIES.some((c) => c.id === id), `${id} assignable`).toBe(true);
    expect(isHideable(id), `${id} hideable`).toBe(true); // user can remove it from pickers
  });

  it('the catch-all `utilities` id + name are preserved byte-identical (golden safety)', () => {
    expect(CATEGORY_BY_ID.get('utilities')).toMatchObject({ name: 'Internet & Utilities' });
  });

  it('all four leaves surface in the Bills & Utilities management group', () => {
    const group = categoryCatalog([]).find((g) => g.group === 'Bills & Utilities');
    const ids = new Set(group?.categories.map((c) => c.id));
    for (const id of NEW_LEAVES) expect(ids.has(id), id).toBe(true);
  });
});

describe('#154 routing: generic keyword rules split by service word', () => {
  const cases: [string, string][] = [
    // electricity — bare POWER/ELECTRIC/ENERGY breadth preserved from the old rule
    ['GEORGIA POWER BILL', 'electricity'],
    ['DUKE ENERGY', 'electricity'],
    ['CONSUMERS ELECTRIC CO', 'electricity'],
    ['CITY LIGHT DEPT', 'electricity'],
    // natural gas — runs before electricity so "ENERGY"/"LIGHT"-named gas utilities win
    ['PIEDMONT NATURAL GAS', 'natural-gas'],
    ['NICOR GAS', 'natural-gas'],
    ['CENTERPOINT ENERGY', 'natural-gas'],
    ['ATLANTA GAS LIGHT CO', 'natural-gas'],
    // water & sewer
    ['CITY OF ATLANTA WATER DEPT', 'water'],
    ['DEKALB COUNTY SEWER', 'water'],
    ['AMERICAN WATER', 'water'],
    // trash & recycling
    ['WASTE MANAGEMENT OF GA', 'trash'],
    ['REPUBLIC SERVICES 855', 'trash'],
    ['GFL ENVIRONMENTAL', 'trash'],
    // catch-all: combined / unlabelled municipal bills stay `utilities`
    ['CITY UTILITIES PAYMENT', 'utilities'],
    ['MUNICIPAL UTILITY DIST', 'utilities'],
    ['NATIONAL GRID', 'utilities'],
  ];
  it.each(cases)('"%s" → %s (auto-filed)', (raw, categoryId) => {
    const m = normalizeMerchant(raw);
    expect(m.categoryId).toBe(categoryId);
    expect(m.confidenceBps).toBeGreaterThanOrEqual(7000); // auto-files, not review
  });
});

describe('#154 NON-regression: unrelated merchants are untouched (goldens hold)', () => {
  it('gasoline stays `fuel` — a gas STATION is not a natural-gas utility', () => {
    expect(normalizeMerchant('COSTCO GAS #1234 ATLANTA').categoryId).toBe('fuel');
    expect(normalizeMerchant('SHELL OIL 57544221800').categoryId).toBe('fuel');
    expect(normalizeMerchant('QT 712 OUTSIDE ATLANTA GA').categoryId).toBe('fuel');
  });

  it('the seed Xfinity bill still files to the `utilities` catch-all', () => {
    expect(normalizeMerchant('COMCAST / XFINITY 800-COMCAST')).toMatchObject({
      canonical: 'Xfinity',
      categoryId: 'utilities',
    });
  });

  it('card e-payments remain transfers (no utility token)', () => {
    for (const d of ['CHASE EPAY SAPPHIRE', 'AMEX EPAYMENT PLATINUM']) {
      expect(normalizeMerchant(d).categoryId).toBe('transfer');
    }
  });
});

describe('#154 critic-hardening: qualified tokens do not misfire on look-alike payees', () => {
  it('bare company names that merely CONTAIN a utility brand word are NOT utilities', () => {
    // CENTERPOINT/SPIRE/CASELLA/CITY WATER/REFUSE are qualified with a service word,
    // so unrelated payees no longer auto-file to a utility leaf (they stay non-utility).
    const notUtility = ['CENTERPOINT MALL', 'SPIRE HOSPITALITY', 'CASELLA WINES', 'CITY WATER PARK', 'REFUSE TO LOSE LLC'];
    for (const raw of notUtility) {
      const id = normalizeMerchant(raw).categoryId;
      expect(['electricity', 'natural-gas', 'water', 'trash', 'utilities'], raw).not.toContain(id);
    }
  });

  it('the real qualified billers still route correctly', () => {
    expect(normalizeMerchant('CENTERPOINT ENERGY').categoryId).toBe('natural-gas');
    expect(normalizeMerchant('SPIRE ENERGY').categoryId).toBe('natural-gas');
    expect(normalizeMerchant('GFL ENVIRONMENTAL SVCS').categoryId).toBe('trash'); // previously a dead token
    expect(normalizeMerchant('CASELLA WASTE SYSTEMS').categoryId).toBe('trash');
  });

  it('a labelled "UTILITIES" e-payment is spend, not a dropped transfer (UTILIT\\b bug fixed)', () => {
    const m = normalizeMerchant('CITY OF SPRINGFIELD UTILITIES EPAY');
    expect(m.categoryId).toBe('utilities');
    expect(m.canonical).toBe('Utility Bill');
  });
});
