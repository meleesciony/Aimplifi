import { transactionsToCsv, type ExportTxn } from '@/lib/export';
const r = (o: Partial<ExportTxn> = {}): ExportTxn => ({
  date: '2026-07-10', account: 'Everyday Checking', rawDescriptor: 'WHOLEFDS 10305',
  merchant: 'Whole Foods', category: 'Groceries', amountCents: -4000, status: 'POSTED',
  onHandoverDay: false, excludeFromTotals: false, isTransfer: false, ...o,
});
console.log('--- plain reader ---');
console.log(transactionsToCsv([r()], { count: 0, currencies: [] }));
console.log('--- transfer only (the demo shape) ---');
console.log(transactionsToCsv([r(), r({ isTransfer: true })], { count: 0, currencies: [] }));
console.log('--- both flags ---');
console.log(transactionsToCsv([r({ excludeFromTotals: true }), r({ isTransfer: true })], { count: 0, currencies: [] }));
