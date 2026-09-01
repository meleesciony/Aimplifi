import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import {
  type ImportDedupeRow,
  normalizeImportDate,
  parseCsvLine,
  parseTransactionCsv,
  planCsvCategoryApply,
  planCsvDedupe,
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

  it('test_regression__simplifi_restaurants_csv_files_dining_not_a_new_leaf', () => {
    const csv = [
      'date,description,amount,category',
      '2026-08-28,Gusto Chastain,-14.43,Restaurants',
      '2026-08-23,Gusto Chastain,-14.43,Food & Dining: Restaurants',
      '2026-08-21,Uber,-12.00,Rideshare',
    ].join('\n');
    const { rows, errors } = parseTransactionCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0].categoryId).toBe('dining');
    expect(rows[1].categoryId).toBe('dining');
    expect(rows[2].categoryId).toBe('transport');
  });
});

describe('planCsvDedupe', () => {
  // Row shorthand: [date, amountCents] — the only fields the planner reads.
  const r = (date: string, amountCents: number): ImportDedupeRow => ({ date: isoDate(date), amountCents });

  it('drops the whole file when the account already holds every row (re-import)', () => {
    const file = [r('2026-06-01', -575), r('2026-06-02', -8420), r('2026-06-03', 250000)];
    const plan = planCsvDedupe(file, file);
    expect(plan.keep).toEqual([false, false, false]);
    expect(plan.duplicates).toBe(3);
  });

  it('keeps deep-history rows the account does not hold', () => {
    const file = [r('2024-01-15', -120000), r('2024-02-10', -8920)];
    const plan = planCsvDedupe(file, [r('2026-06-01', -575)]);
    expect(plan.keep).toEqual([true, true]);
    expect(plan.duplicates).toBe(0);
  });

  it('matches provider-synced rows on (date, signed amount) regardless of descriptor', () => {
    // Bank statement text vs the provider's rawDescriptor never match verbatim
    // (H.6): the key excludes the descriptor BY CONSTRUCTION. Same day, same
    // signed amount → the provider's copy is the same charge, dropped.
    const file = [r('2026-06-01', -8420)]; // "GOOSE POND BAR GRILLE"
    const store = [r('2026-06-01', -8420)]; // "SQ *GOOSE POND"
    expect(planCsvDedupe(file, store).keep).toEqual([false]);
  });

  it('splits a partially overlapping file correctly', () => {
    const file = [
      r('2026-06-01', -575), // in store
      r('2026-06-01', -8420), // in store
      r('2026-06-01', -3000), // new
      r('2026-05-30', -1200), // new
      r('2026-06-02', -8420), // new — same amount, different day
    ];
    const store = [r('2026-06-01', -575), r('2026-06-01', -8420)];
    const plan = planCsvDedupe(file, store);
    expect(plan.keep).toEqual([false, false, true, true, true]);
    expect(plan.duplicates).toBe(2);
  });

  it('implements a multiset difference: file 3 of a key, store 2 → keeps 1', () => {
    // Two identical $5 charges already synced; the file holds three of them.
    const file = [r('2026-06-01', -500), r('2026-06-01', -500), r('2026-06-01', -500)];
    const store = [r('2026-06-01', -500), r('2026-06-01', -500)];
    const plan = planCsvDedupe(file, store);
    expect(plan.keep).toEqual([false, false, true]);
    expect(plan.duplicates).toBe(2);
  });

  it('never creates a key beyond what the file offers (file 2, store 3 → all dropped)', () => {
    const file = [r('2026-06-01', -500), r('2026-06-01', -500)];
    const store = [r('2026-06-01', -500), r('2026-06-01', -500), r('2026-06-01', -500)];
    expect(planCsvDedupe(file, store).keep).toEqual([false, false]);
  });

  it('treats sign as part of the identity: a $5 refund is not a $5 charge', () => {
    const file = [r('2026-06-01', 500)];
    const store = [r('2026-06-01', -500)];
    expect(planCsvDedupe(file, store).keep).toEqual([true]);
  });

  it('uses an exact (date, amount) match — no ±N-day window (C.6)', () => {
    // The C.6 lesson: a loose pair rule once credited 11 refunds as payments.
    // A charge a day apart with the same amount is NOT the same charge.
    const file = [r('2026-06-02', -8420)];
    const store = [r('2026-06-01', -8420)];
    expect(planCsvDedupe(file, store).keep).toEqual([true]);
  });

  it('preserves file order in the kept rows', () => {
    const file = [
      r('2026-06-01', -575),
      r('2026-06-02', -8420),
      r('2026-06-03', -3000),
      r('2026-06-04', -1200),
    ];
    const store = [r('2026-06-02', -8420)];
    const plan = planCsvDedupe(file, store);
    expect(plan.keep).toEqual([true, false, true, true]);
    expect(plan.duplicates).toBe(1);
  });

  it('drops a whole-charge row whose split parent already represents it', () => {
    // The file's "TRADER JOE" -100.00 row vs the store's split parent carrying
    // (date, -10000): the charge is already in the account as its pieces.
    const file = [r('2026-06-01', -10000)];
    const store = [r('2026-06-01', -10000)]; // split parent of the same charge
    expect(planCsvDedupe(file, store).keep).toEqual([false]);
  });

  it('handles an empty file and an empty store', () => {
    expect(planCsvDedupe([], [r('2026-06-01', -575)])).toEqual({ keep: [], duplicates: 0, repeatedRows: 0 });
    expect(planCsvDedupe([r('2026-06-01', -575)], []).keep).toEqual([true]);
    expect(planCsvDedupe([], [])).toEqual({ keep: [], duplicates: 0, repeatedRows: 0 });
  });
});

describe('planCsvDedupe repeatedRows (critic P1-1)', () => {
  const r = (date: string, amountCents: number): ImportDedupeRow => ({ date: isoDate(date), amountCents });

  it('flags a key repeated in the file when nothing is stored (pasted-overlap export)', () => {
    // Two overlapping exports pasted together: the shared chunk appears twice,
    // the account holds none of it. Both rows import (multiset semantics
    // untouched) but the count says the file looks double-pasted.
    const file = [r('2024-01-15', -8920), r('2024-01-15', -8920)];
    const plan = planCsvDedupe(file, []);
    expect(plan.keep).toEqual([true, true]);
    expect(plan.duplicates).toBe(0);
    expect(plan.repeatedRows).toBe(2);
  });

  it('is quiet on a plain re-import — nothing kept, nothing to warn', () => {
    const file = [r('2024-01-15', -8920), r('2024-01-15', -8920)];
    const store = [r('2024-01-15', -8920), r('2024-01-15', -8920)];
    const plan = planCsvDedupe(file, store);
    expect(plan.keep).toEqual([false, false]);
    expect(plan.duplicates).toBe(2);
    expect(plan.repeatedRows).toBe(0);
  });

  it('counts only the KEPT rows of a repeated key (file 3, store 1 → 2)', () => {
    const file = [r('2026-06-01', -500), r('2026-06-01', -500), r('2026-06-01', -500)];
    const store = [r('2026-06-01', -500)];
    const plan = planCsvDedupe(file, store);
    expect(plan.keep).toEqual([false, true, true]);
    expect(plan.duplicates).toBe(1);
    expect(plan.repeatedRows).toBe(2);
  });

  it('counts only the repeated key in a mixed file; single-occurrence keys never warn', () => {
    const file = [
      r('2026-06-01', -575), // once
      r('2026-06-01', -8420), // twice → the warning's source
      r('2026-06-01', -8420),
      r('2026-05-30', -1200), // once
    ];
    const plan = planCsvDedupe(file, []);
    expect(plan.keep).toEqual([true, true, true, true]);
    expect(plan.duplicates).toBe(0);
    expect(plan.repeatedRows).toBe(2);
  });

  it('treats sign as part of the key here too: +500 and -500 same day are not repeats', () => {
    const file = [r('2026-06-01', -500), r('2026-06-01', 500)];
    const plan = planCsvDedupe(file, []);
    expect(plan.keep).toEqual([true, true]);
    expect(plan.repeatedRows).toBe(0);
  });

  it('warns, never blocks: two genuine same-day same-amount charges stay imports', () => {
    // The honest-hint contract: the count is surfaced, the rows are created.
    const file = [r('2026-06-01', -450), r('2026-06-01', -450)];
    const plan = planCsvDedupe(file, []);
    expect(plan.keep).toEqual([true, true]);
    expect(plan.duplicates).toBe(0);
    expect(plan.repeatedRows).toBe(2);
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


describe('planCsvCategoryApply', () => {
  it('test_regression__simplifi_csv_recategorizes_duplicate_existing_row', () => {
    const file = [
      { date: isoDate('2026-08-28'), amountCents: -1443, categoryId: 'dining' },
    ];
    const existing = [
      { id: 'txn-gusto', date: isoDate('2026-08-28'), amountCents: -1443, categoryId: 'fast-food' },
    ];
    const plan = planCsvDedupe(file, existing);
    expect(plan.keep).toEqual([false]);
    const applies = planCsvCategoryApply(file, existing, plan.keep);
    expect(applies).toEqual([{ transactionId: 'txn-gusto', categoryId: 'dining' }]);
  });

  it('does not recategorize when the file has no category', () => {
    const file = [{ date: isoDate('2026-08-28'), amountCents: -1443, categoryId: null }];
    const existing = [
      { id: 'txn-gusto', date: isoDate('2026-08-28'), amountCents: -1443, categoryId: 'fast-food' },
    ];
    const plan = planCsvDedupe(file, existing);
    expect(planCsvCategoryApply(file, existing, plan.keep)).toEqual([]);
  });

  it('does not recategorize a new row the account does not hold', () => {
    const file = [{ date: isoDate('2026-08-28'), amountCents: -1443, categoryId: 'dining' }];
    const plan = planCsvDedupe(file, []);
    expect(plan.keep).toEqual([true]);
    expect(planCsvCategoryApply(file, [], plan.keep)).toEqual([]);
  });

  it('skips when the existing row already has the export category', () => {
    const file = [{ date: isoDate('2026-08-28'), amountCents: -1443, categoryId: 'dining' }];
    const existing = [
      { id: 'txn-gusto', date: isoDate('2026-08-28'), amountCents: -1443, categoryId: 'dining' },
    ];
    const plan = planCsvDedupe(file, existing);
    expect(planCsvCategoryApply(file, existing, plan.keep)).toEqual([]);
  });
});
