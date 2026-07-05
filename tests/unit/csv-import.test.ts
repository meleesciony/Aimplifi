import { describe, expect, it } from 'vitest';
import {
  normalizeImportDate,
  parseCsvLine,
  parseTransactionCsv,
  prepareImportedTransaction,
} from '@/lib/engine/transactions/csv-import';

describe('parseCsvLine', () => {
  it('splits plain fields and trims', () => {
    expect(parseCsvLine('2026-06-01, Coffee , -4.50')).toEqual(['2026-06-01', 'Coffee', '-4.50']);
  });
  it('honors quoted fields containing commas', () => {
    expect(parseCsvLine('2026-06-01,"BLUE BOTTLE, OAK",-12.50')).toEqual([
      '2026-06-01',
      'BLUE BOTTLE, OAK',
      '-12.50',
    ]);
  });
  it('handles escaped quotes ("")', () => {
    expect(parseCsvLine('"She said ""hi""",1')).toEqual(['She said "hi"', '1']);
  });
});

describe('normalizeImportDate', () => {
  it('passes ISO dates through', () => {
    expect(normalizeImportDate('2026-06-09')).toBe('2026-06-09');
  });
  it('converts US MM/DD/YYYY', () => {
    expect(normalizeImportDate('6/9/2026')).toBe('2026-06-09');
    expect(normalizeImportDate('12/31/2025')).toBe('2025-12-31');
  });
  it('rejects unrecognized formats', () => {
    expect(() => normalizeImportDate('09-06-2026')).toThrow();
    expect(() => normalizeImportDate('June 9')).toThrow();
  });
});

describe('parseTransactionCsv', () => {
  it('parses a valid file with aliased headers and signed amounts', () => {
    const csv = [
      'Date,Payee,Amount',
      '2026-06-01,Acme Payroll,2500.00',
      '2026-06-02,"Kroger, Midtown",-84.20',
      '06/03/2026,Coffee,-4.50',
    ].join('\n');
    const { rows, errors } = parseTransactionCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: '2026-06-01', description: 'Acme Payroll', amountCents: 250000 });
    expect(rows[1]).toMatchObject({ date: '2026-06-02', description: 'Kroger, Midtown', amountCents: -8420 });
    expect(rows[2]).toMatchObject({ date: '2026-06-03', amountCents: -450 });
  });

  it('strips $ and thousands commas from amounts', () => {
    const csv = 'date,description,amount\n2026-06-01,Rent,"-$1,250.00"';
    const { rows, errors } = parseTransactionCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0].amountCents).toBe(-125000);
  });

  it('reports per-row errors with line numbers and keeps good rows', () => {
    const csv = [
      'date,description,amount',
      '2026-06-01,Good,-10.00',
      'not-a-date,Bad date,-5.00',
      '2026-06-03,,-5.00',
      '2026-06-04,Bad amount,abc',
    ].join('\n');
    const { rows, errors } = parseTransactionCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('Good');
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(errors[1].message).toMatch(/empty/i); // line 4: empty description
  });

  it('flags missing required columns at the header', () => {
    const { rows, errors } = parseTransactionCsv('date,memo\n2026-06-01,x');
    expect(rows).toEqual([]);
    expect(errors[0].message).toMatch(/amount/i);
  });

  it('treats a fully blank file as an error', () => {
    expect(parseTransactionCsv('\n\n  \n').errors[0].message).toMatch(/empty/i);
  });

  it('accepts an optional category column (slug or display name)', () => {
    const csv = [
      'date,description,amount,category',
      '2026-06-01,Mystery LLC,-20.00,groceries',
      '2026-06-02,Other LLC,-30.00,Dining Out',
      '2026-06-03,Third LLC,-40.00,not-a-category',
    ].join('\n');
    const { rows } = parseTransactionCsv(csv);
    expect(rows[0].categoryId).toBe('groceries');
    expect(rows[1].categoryId).toBe('dining'); // resolved from display name
    expect(rows[2].categoryId).toBeNull(); // unknown → auto
  });

  it('resolves a custom category name when given the user map (DECISIONS #111)', () => {
    const csv = [
      'date,description,amount,category',
      '2026-06-01,Bear Creek GC,-90.00,Golf',
      '2026-06-02,Other LLC,-30.00,Golf', // case-insensitive match below
    ].join('\n');
    const customByName = new Map([['golf', 'cust_golf']]);
    const withMap = parseTransactionCsv(csv, customByName).rows;
    expect(withMap[0].categoryId).toBe('cust_golf');
    expect(withMap[1].categoryId).toBe('cust_golf');
    // Without the map, the same custom name is unknown → auto-categorize (null).
    const withoutMap = parseTransactionCsv(csv).rows;
    expect(withoutMap[0].categoryId).toBeNull();
  });
});

describe('prepareImportedTransaction', () => {
  const rules = [] as const;

  it('auto-categorizes a known merchant and preserves the signed amount', () => {
    const [row] = parseTransactionCsv('date,description,amount\n2026-06-01,STARBUCKS STORE 5,-5.75').rows;
    const prepared = prepareImportedTransaction(row, 'acct-checking', rules);
    expect(prepared.amountCents).toBe(-575);
    expect(prepared.categoryId).toBe('coffee'); // #163: Starbucks = coffee
    expect(prepared.needsReview).toBe(false);
    expect(prepared.status).toBe('POSTED');
  });

  it('honors an explicit category (authoritative, no review)', () => {
    const [row] = parseTransactionCsv('date,description,amount,category\n2026-06-01,XYZ,-9.99,household').rows;
    const prepared = prepareImportedTransaction(row, 'acct-checking', rules);
    expect(prepared.categoryId).toBe('household');
    expect(prepared.needsReview).toBe(false);
  });

  it('marks a transfer descriptor as a transfer', () => {
    const [row] = parseTransactionCsv('date,description,amount\n2026-06-01,ONLINE TRANSFER TO SAVINGS,-500.00').rows;
    const prepared = prepareImportedTransaction(row, 'acct-checking', rules);
    expect(prepared.isTransfer).toBe(true);
    expect(prepared.categoryId).toBe('transfer');
  });
});
