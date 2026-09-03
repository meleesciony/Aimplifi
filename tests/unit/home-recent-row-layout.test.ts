/**
 * Home recent-charge row alignment + “Money out” (DECISIONS #638).
 *
 * Owner: the Home recents were not lined up, and compact “Out” did not
 * say what it meant. Writes stay; the row is a 3-column grid (payee,
 * dollars, Open) with meta on a wrapping second line. Compact direction
 * uses the same words as detail — Money in / Money out — not In / Out.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Home recent-charge row lines up and names money out', () => {
  it('test_regression__home_recent_charges_line_up_and_name_money_out', () => {
    const card = readFileSync(resolve('src/components/dashboard/recent-transactions-card.tsx'), 'utf8');
    expect(card).toContain('grid-cols-[minmax(0,1fr)_auto_auto]');
    expect(card).toContain('col-span-3');
    expect(card).toContain('justify-self-end');
    expect(card).toContain('text-right text-sm tabular-nums');

    const mapStart = card.indexOf('rows.map');
    expect(mapStart).toBeGreaterThan(-1);
    const mapBlock = card.slice(mapStart);
    const amountIdx = mapBlock.indexOf('<TxnAmountControl');
    const linkIdx = mapBlock.indexOf('data-testid="dashboard-recent-row"');
    const metaIdx = mapBlock.indexOf('col-span-3');
    const directionIdx = mapBlock.indexOf('<TxnDirectionControl');
    expect(amountIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeGreaterThan(-1);
    expect(metaIdx).toBeGreaterThan(-1);
    expect(directionIdx).toBeGreaterThan(-1);
    expect(amountIdx).toBeLessThan(linkIdx);
    expect(linkIdx).toBeLessThan(metaIdx);
    expect(metaIdx).toBeLessThan(directionIdx);

    const form = readFileSync(resolve('src/components/finance/txn-direction-form.tsx'), 'utf8');
    expect(form).toContain("const current = isIn ? 'Money in' : 'Money out'");
    expect(form).toContain("{busy ? 'Saving…' : current}");
    expect(form).not.toContain("isIn ? 'In' : 'Out'");
  });
});
