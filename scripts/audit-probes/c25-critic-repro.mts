/**
 * Reproduction of the C.25 critic's P0-1 and P0-2 (pure, no I/O, no database).
 * A delegated finding is a hypothesis until it is executed here.
 */
import { planTransferUpdates } from '../../src/lib/engine/categorize/transfers';
import { normalizeMerchant } from '../../src/lib/engine/categorize/normalize';

for (const d of ['ONLINE PAYMENT', 'BILL PAY', 'ACH DEBIT', 'ELECTRONIC PAYMENT', 'CHECK 1041']) {
  const m = normalizeMerchant(d);
  console.log(`${d.padEnd(20)} -> ${JSON.stringify(m.canonical).padEnd(24)} aggregate=${m.aggregate}`);
}

const TYPES = new Map([
  ['chk', 'CHECKING'],
  ['loan', 'LOAN'],
  ['mtg', 'MORTGAGE'],
]);
const base = {
  isTransfer: false,
  needsReview: true,
  reviewPinned: false,
  status: 'POSTED',
  currencySupported: true,
};

console.log('\n── P0-1: one generic-descriptor loan payment sweeps the whole bill stack ──');
console.log(
  JSON.stringify(
    planTransferUpdates(
      [
        { id: 'loanpay', accountId: 'chk', date: '2026-06-05', amountCents: -45_000, rawDescriptor: 'ONLINE PAYMENT', accountType: TYPES.get('chk')!, categoryId: null, ...base },
        { id: 'loanside', accountId: 'loan', date: '2026-06-06', amountCents: 45_000, rawDescriptor: 'Payment', accountType: TYPES.get('loan')!, categoryId: null, ...base },
        { id: 'rent', accountId: 'chk', date: '2026-06-01', amountCents: -190_000, rawDescriptor: 'ONLINE PAYMENT', accountType: TYPES.get('chk')!, categoryId: null, ...base },
        { id: 'electric', accountId: 'chk', date: '2026-06-12', amountCents: -22_000, rawDescriptor: 'ONLINE PAYMENT', accountType: TYPES.get('chk')!, categoryId: null, ...base },
        { id: 'internet', accountId: 'chk', date: '2026-06-14', amountCents: -9_500, rawDescriptor: 'ONLINE PAYMENT', accountType: TYPES.get('chk')!, categoryId: null, ...base },
      ],
    ),
    null,
    2,
  ),
);

console.log('\n── P0-2: one coincidental amount classifies a payee at EVERY amount, forever ──');
console.log(
  JSON.stringify(
    planTransferUpdates(
      [
        { id: 'mtg-in-jun', accountId: 'mtg', date: '2026-06-18', amountCents: 621_707, rawDescriptor: 'Payment', accountType: TYPES.get('mtg')!, categoryId: null, ...base },
        { id: 'roof-jun', accountId: 'chk', date: '2026-06-17', amountCents: -621_707, rawDescriptor: 'ABC ROOFING & SIDING', accountType: TYPES.get('chk')!, categoryId: null, ...base },
        { id: 'roof-aug', accountId: 'chk', date: '2026-08-04', amountCents: -621_707, rawDescriptor: 'ABC ROOFING & SIDING', accountType: TYPES.get('chk')!, categoryId: null, ...base },
        { id: 'roof-sep', accountId: 'chk', date: '2026-09-04', amountCents: -125_000, rawDescriptor: 'ABC ROOFING & SIDING', accountType: TYPES.get('chk')!, categoryId: null, ...base },
      ],
    ),
    null,
    2,
  ),
);
