/**
 * The tax-year export as the file the reader opens: `taxExportToCsv` +
 * `normalizeNote`, plus the shared CSV encoder both of them lean on.
 *
 * The interesting assertions here are not "does it join with commas" — they are the
 * two ways a CSV can lie: a note that carries a comma or a quote and silently shifts
 * every column after it, and a leading `=` that a spreadsheet executes as a formula.
 */
import { describe, expect, it } from 'vitest';
import { buildTaxExport, type TaxExportRow } from '@/lib/engine/tax/export';
import { taxExportFilename, taxExportToCsv } from '@/lib/engine/tax/csv';
import { normalizeNote, noteErrorMessage, TXN_NOTE_MAX_CHARS } from '@/lib/engine/tax/note';
import { csvAmount, csvField } from '@/lib/csv';

const row = (over: Partial<TaxExportRow> & Pick<TaxExportRow, 'date' | 'amountCents'>): TaxExportRow => ({
  description: 'Test Merchant',
  status: 'POSTED',
  isTransfer: false,
  isSplitParent: false,
  taxClass: 'medical',
  note: null,
  ...over,
});

/** Split a CSV document into records for assertions. Safe here because every
 *  fixture below keeps its embedded newlines inside ONE asserted field. */
const lines = (csv: string) => csv.split('\r\n');

describe('csvField / csvAmount — one author for every CSV this app emits', () => {
  it('neutralizes a leading formula character so a spreadsheet reads it as text', () => {
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvField('-- drop table')).toBe("'-- drop table");
  });

  it('quotes and doubles, so a comma or a quote cannot shift the next column', () => {
    expect(csvField('Mum, and Dad')).toBe('"Mum, and Dad"');
    expect(csvField('she said "ouch"')).toBe('"she said ""ouch"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
  });

  it('does NOT neutralize a negative amount — that would drop it out of the reader\'s SUM', () => {
    // `-42.10` starts with `-`, which csvField WOULD prefix. csvAmount must not,
    // or every refund lands in the spreadsheet as text and totals wrong.
    expect(csvAmount(-4_210)).toBe('-42.10');
    expect(csvAmount(0)).toBe('0.00');
    expect(csvAmount(4_210)).toBe('42.10');
  });
});

describe('normalizeNote', () => {
  it('trims the ends and keeps the interior exactly as typed', () => {
    expect(normalizeNote('  mum\'s  prescription \n ')).toEqual({ ok: true, note: "mum's  prescription" });
  });

  it('turns empty and whitespace-only into null, so "cleared" and "never wrote one" match', () => {
    expect(normalizeNote('')).toEqual({ ok: true, note: null });
    expect(normalizeNote('   \n\t ')).toEqual({ ok: true, note: null });
    expect(normalizeNote(null)).toEqual({ ok: true, note: null });
    expect(normalizeNote(undefined)).toEqual({ ok: true, note: null });
  });

  it('accepts exactly the cap and REJECTS one over — never truncates', () => {
    expect(normalizeNote('x'.repeat(TXN_NOTE_MAX_CHARS))).toEqual({
      ok: true,
      note: 'x'.repeat(TXN_NOTE_MAX_CHARS),
    });
    const over = normalizeNote('x'.repeat(TXN_NOTE_MAX_CHARS + 1));
    expect(over).toEqual({ ok: false, error: 'too-long' });
    // Silently cutting the end off someone's record of what a charge was is a data
    // loss they would not discover until tax time.
    expect(noteErrorMessage('too-long')).toContain(String(TXN_NOTE_MAX_CHARS));
    expect(noteErrorMessage('too-long')).toContain('nothing was saved');
  });

  it('measures the cap AFTER trimming, so trailing whitespace never causes a refusal', () => {
    expect(normalizeNote(`${'x'.repeat(TXN_NOTE_MAX_CHARS)}     `)).toEqual({
      ok: true,
      note: 'x'.repeat(TXN_NOTE_MAX_CHARS),
    });
  });
});

describe('taxExportToCsv', () => {
  const report = buildTaxExport(
    [
      // Medical: $120.00 out, $20.00 back → net $100.00.
      row({ date: '2025-02-03', amountCents: -12_000, description: 'CVS Pharmacy', note: "mum's prescription" }),
      row({ date: '2025-06-01', amountCents: 2_000, description: 'CVS Pharmacy', note: 'refund' }),
      // Business: $50.00 out.
      row({ date: '2025-04-04', amountCents: -5_000, description: 'Staples', taxClass: 'business' }),
    ],
    2025,
  );

  it('puts the year and every disclosure at the TOP, before any figure', () => {
    const out = lines(taxExportToCsv(report));
    expect(out[0]).toBe('Aimplifi tax-year export,2025');
    const headerIdx = out.indexOf('tax_class,date,description,amount,note');
    const disclosureIdx = out.findIndex((l) => l.includes('not tax advice'));
    expect(disclosureIdx).toBeGreaterThan(0);
    // The sentence that says this is not advice must be above the numbers, not in a
    // footer a scroll or a print can miss.
    expect(disclosureIdx).toBeLessThan(headerIdx);
    expect(out.some((l) => l.includes('subtracted from its own group'))).toBe(true);
  });

  it('lists every line with its class, signed, and totals each class separately', () => {
    const out = lines(taxExportToCsv(report));
    expect(out).toContain('Medical & dental,2025-02-03,CVS Pharmacy,-120.00,mum\'s prescription');
    expect(out).toContain('Medical & dental,2025-06-01,CVS Pharmacy,20.00,refund');
    expect(out).toContain('Business expense,2025-04-04,Staples,-50.00,');
    // Totals table: net paid, then what came back.
    expect(out).toContain('tax_class,net_paid,refunded');
    expect(out).toContain('Medical & dental,100.00,20.00'); // 120.00 − 20.00
    expect(out).toContain('Business expense,50.00,0.00');
    // The business box totals as its own group and is never folded into an
    // itemized subtotal — the grand row is named after arithmetic, not a tax outcome.
    expect(out).toContain('All groups,150.00,20.00');
    expect(out.some((l) => /deductible/i.test(l) && l.startsWith('All groups'))).toBe(false);
  });

  it('carries a note verbatim, quoted, so a comma in it cannot shift the columns', () => {
    const out = lines(
      taxExportToCsv(
        buildTaxExport(
          [row({ date: '2025-01-01', amountCents: -1_000, description: 'Clinic', note: 'Mum, then Dad' })],
          2025,
        ),
      ),
    );
    const line = out.find((l) => l.startsWith('Medical & dental,2025-01-01'));
    expect(line).toBe('Medical & dental,2025-01-01,Clinic,-10.00,"Mum, then Dad"');
  });

  it('neutralizes a formula that arrived in a descriptor or a note', () => {
    const out = taxExportToCsv(
      buildTaxExport(
        [row({ date: '2025-01-01', amountCents: -1_000, description: '=cmd|calc', note: '@evil' })],
        2025,
      ),
    );
    expect(out).toContain("'=cmd|calc");
    expect(out).toContain("'@evil");
  });

  it('says which zero it is when a tagged year has nothing that survived the gates', () => {
    // Everything tagged in 2025 is still pending: the file must explain itself
    // rather than arrive as a lone header row.
    const empty = buildTaxExport([row({ date: '2025-09-09', amountCents: -1_000, status: 'PENDING' })], 2025);
    const out = taxExportToCsv(empty);
    expect(out).toContain('Nothing to list for this year');
    expect(out).toContain('not posted yet');
    expect(lines(out)).toContain('All groups,0.00,0.00');
  });

  it('names the file after the year it reports', () => {
    expect(taxExportFilename(2025)).toBe('aimplifi-tax-2025.csv');
  });

  it('separates records with CRLF and ends the document with one (RFC 4180)', () => {
    const out = taxExportToCsv(report);
    expect(out.endsWith('\r\n')).toBe(true);
    // Every LF in the document is part of a CRLF pair — no bare LF record break that
    // a strict parser would read as a field continuation. (The blank rows between the
    // three sections are deliberate empty records, so `\r\n\r\n` is expected.)
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
  });
});
