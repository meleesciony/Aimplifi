/**
 * Live 2026-09-01 /transactions showed bank-feed leftovers as payee names:
 * "Debellis & Assoc Purchase Trn Fj8xzkz", "Linkagnt Hertz",
 * "Www.springscinema.com", "Local Expedition - S". Those tokens are not a
 * payee. Display and ingest must strip them. A reader's renameTo is kept.
 */
import { describe, expect, it } from 'vitest';
import { cleanDescriptor, stripPayeeNoise } from '@/lib/engine/categorize/normalize';
import { registerDisplayName } from '@/lib/engine/transactions/display-name';

describe('payee noise is not a name (DECISIONS #537)', () => {
  it('test_regression__purchase_trn_and_www_are_not_the_payee', () => {
    expect(cleanDescriptor('DEBELLIS & ASSOC PURCHASE TRN FJ8XZKZ')).toBe('Debellis & Assoc');
    expect(cleanDescriptor('LINKAGNT HERTZ')).toBe('Hertz');
    expect(cleanDescriptor('WWW.SPRINGSCINEMA.COM')).toBe('Springscinema.com');
    expect(cleanDescriptor('LOCAL EXPEDITION - S')).toBe('Local Expedition');
    expect(cleanDescriptor('PRINCIPAL-CCAPNL PRIN FINAN ~ TRAN')).toBe('Principal-ccapnl Prin Finan');

    expect(stripPayeeNoise('Debellis & Assoc Purchase Trn Fj8xzkz')).toBe('Debellis & Assoc');
    expect(stripPayeeNoise('Www.springscinema.com')).toBe('springscinema.com');
    expect(stripPayeeNoise("Mum's Pharmacy")).toBe("Mum's Pharmacy");
  });

  it('test_regression__register_strips_persisted_payee_noise_not_a_rename', () => {
    expect(
      registerDisplayName({
        merchant: { canonical: 'Debellis & Assoc Purchase Trn Fj8xzkz' },
        rawDescriptor: 'DEBELLIS & ASSOC PURCHASE TRN FJ8XZKZ',
      }),
    ).toBe('Debellis & Assoc');
    expect(
      registerDisplayName({
        merchant: { canonical: "Mum's Pharmacy" },
        rawDescriptor: 'SQ *WALGREENS #4471 CHICAGO IL',
      }),
    ).toBe("Mum's Pharmacy");
    expect(registerDisplayName({ rawDescriptor: 'LINKAGNT HERTZ' })).toBe('Hertz');
  });
});

describe('POS prefixes are not a payee name (DECISIONS #542)', () => {
  it('test_regression__tst_and_sq_prefixes_are_not_the_payee', () => {
    expect(stripPayeeNoise('TST* Local Cafe')).toBe('Local Cafe');
    expect(stripPayeeNoise('SQ *Blue Bottle')).toBe('Blue Bottle');
    expect(stripPayeeNoise('PAYPAL *SOME SHOP')).toBe('SOME SHOP');
    expect(
      registerDisplayName({
        merchant: { canonical: 'TST* Local Cafe' },
        rawDescriptor: 'TST* LOCAL CAFE',
      }),
    ).toBe('Local Cafe');
    expect(
      registerDisplayName({
        merchant: { canonical: "Mum's Pharmacy" },
        rawDescriptor: 'SQ *WALGREENS #4471 CHICAGO IL',
      }),
    ).toBe("Mum's Pharmacy");
  });
});
