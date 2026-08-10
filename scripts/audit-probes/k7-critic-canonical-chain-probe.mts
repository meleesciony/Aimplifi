/**
 * Hostile-critic probe (K.7 review): does the C.25 fact canonical line up with
 * the canonical the split re-derives from a DETECTED scheduled row's description?
 *
 * Chain on the ordinary shape:
 *   raw transaction descriptor  -> C.25 fact canonical (loan-payment-flows.ts:266)
 *   raw transaction descriptor  -> detector series canonical (detect.ts:384,248)
 *   series.merchantCanonical    -> toScheduledRow description (detect.ts:725)
 *   scheduled row description   -> split re-derived canonical (duplicate-projection.ts:150)
 */
import { normalizeMerchant } from '../../src/lib/engine/categorize/normalize';
import { splitLoanCarriedScheduled } from '../../src/lib/engine/loans/duplicate-projection';
// The demo seed's ACTUAL auto-loan ACH descriptor (src/lib/seed/build.ts:319).
const RAW_DEMO = 'ACH WITHDRAWAL CARMAX AUTO FIN 4421';
// The test fixture's descriptor (tests/unit/loan-duplicate-projection.test.ts:15).
const RAW_FIXTURE = 'CARMAX AUTO FINANCE';

const c25Mint = normalizeMerchant(RAW_DEMO).canonical;
const fixtureMint = normalizeMerchant(RAW_FIXTURE).canonical;

console.log('C.25 mints for the REAL demo descriptor :', JSON.stringify(c25Mint));
console.log('C.25 mints for the TEST fixture descriptor:', JSON.stringify(fixtureMint));

// A detected row's description IS the series canonical (toScheduledRow).
const detectedRowDescription = c25Mint;
const reDerived = normalizeMerchant(detectedRowDescription).canonical;
console.log('detected row description (canonical)     :', JSON.stringify(detectedRowDescription));
console.log('split re-derives from that description   :', JSON.stringify(reDerived));
console.log('re-derived === C.25 fact canonical?      :', reDerived === c25Mint);

// The engine under the REAL chain: fact canonical from C.25, row as recurring.ts persists it.
const obligations = [{ accountId: 'acct-autoloan', paymentCents: 38500 }];
const carried = [{ canonical: c25Mint, accountId: 'acct-autoloan', paymentCents: 38500 }];
const realRow = { description: detectedRowDescription, amountCents: -38500, nextDate: '2026-07-05' };
const real = splitLoanCarriedScheduled({ scheduled: [realRow], obligations, carried });
console.log('REAL chain suppressed?                   :', real.suppressed.length > 0, '(kept:', real.kept.length, ')');

// The fixture chain (what the unit test asserts):
const fixtureRow = { description: RAW_FIXTURE, amountCents: -38500, nextDate: '2026-07-05' };
const fixtureCarried = [{ canonical: fixtureMint, accountId: 'acct-autoloan', paymentCents: 38500 }];
const fx = splitLoanCarriedScheduled({ scheduled: [fixtureRow], obligations, carried: fixtureCarried });
console.log('FIXTURE chain suppressed?                :', fx.suppressed.length > 0, '(kept:', fx.kept.length, ')');

// Does the detector even keep the demo ACH? (detect.ts:389 keeps isTransfer rows with auto-loan category.)
console.log('demo descriptor categoryId               :', normalizeMerchant(RAW_DEMO).categoryId);
console.log('demo descriptor aggregate?               :', normalizeMerchant(RAW_DEMO).aggregate);
