import { describe, expect, it } from 'vitest';
import {
  CSV_EXPORT_GUIDES,
  GENERIC_CSV_GUIDE,
  csvExportGuideFor,
} from '@/lib/engine/transactions/csv-export-guide';

describe('csvExportGuideFor', () => {
  it('matches the exact institution names /accounts shows (H.2)', () => {
    // The seven institutions with web-verified export cards (the guide set).
    for (const name of ['Chase', 'Capital One', 'American Express', 'Charles Schwab', 'Vanguard', 'Truist', 'U.S. Bank']) {
      expect(csvExportGuideFor(name), name).not.toBeNull();
    }
  });

  it('normalizes punctuation and case in names', () => {
    expect(csvExportGuideFor('US Bank')?.institution).toBe('U.S. Bank');
    expect(csvExportGuideFor('usbank')?.institution).toBe('U.S. Bank');
    expect(csvExportGuideFor('capital one')?.institution).toBe('Capital One');
  });

  it('resolves the documented aliases', () => {
    expect(csvExportGuideFor('Amex')?.institution).toBe('American Express');
    expect(csvExportGuideFor('Schwab')?.institution).toBe('Charles Schwab');
  });

  it('returns null for an unknown institution (generic card covers it)', () => {
    expect(csvExportGuideFor('First National Bank of Nowhere')).toBeNull();
    expect(csvExportGuideFor('')).toBeNull();
  });
});

describe('CSV_EXPORT_GUIDES content', () => {
  it('every guide has a non-empty title and at least one step, all non-empty', () => {
    for (const g of CSV_EXPORT_GUIDES) {
      expect(g.institution.length, g.institution).toBeGreaterThan(0);
      expect(g.steps.length, g.institution).toBeGreaterThan(0);
      for (const s of g.steps) expect(s.trim().length, `${g.institution}: ${s}`).toBeGreaterThan(0);
    }
  });

  it('each bank is listed exactly once', () => {
    const names = CSV_EXPORT_GUIDES.map((g) => g.institution);
    expect(new Set(names).size).toBe(names.length);
  });

  it('the generic guide is complete copy', () => {
    expect(GENERIC_CSV_GUIDE.steps.length).toBeGreaterThan(0);
    expect(GENERIC_CSV_GUIDE.note).toBeTruthy();
  });
});
