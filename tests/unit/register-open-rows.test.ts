/**
 * U.1b — which register rows are open, kept for the session. The storage half is two
 * guarded calls; the part worth pinning is what survives a round trip and what is refused,
 * because the value is read back on every load of the busiest page in the app.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_OPEN_ROWS, parseOpenRows, withRowOpen } from '@/components/finance/register-open-rows';

describe('parseOpenRows', () => {
  it('reads back what withRowOpen wrote', () => {
    const open = withRowOpen(withRowOpen(new Set(), 'txn-1', true), 'txn-2', true);
    expect([...parseOpenRows(JSON.stringify([...open]))]).toEqual(['txn-1', 'txn-2']);
  });

  it('is empty for nothing, for junk, and for a value this build did not write', () => {
    expect(parseOpenRows(null).size).toBe(0);
    expect(parseOpenRows('').size).toBe(0);
    expect(parseOpenRows('{not json').size).toBe(0);
    expect(parseOpenRows('{"txn-1":true}').size).toBe(0);
    expect(parseOpenRows('"txn-1"').size).toBe(0);
  });

  it('keeps only strings — an id is never coerced out of a number or an object', () => {
    expect([...parseOpenRows(JSON.stringify(['a', 1, null, { id: 'b' }, 'c']))]).toEqual(['a', 'c']);
  });

  it('caps what it will accept, newest last', () => {
    const many = Array.from({ length: MAX_OPEN_ROWS + 5 }, (_, i) => `t${i}`);
    const parsed = [...parseOpenRows(JSON.stringify(many))];
    expect(parsed).toHaveLength(MAX_OPEN_ROWS);
    expect(parsed[0]).toBe('t5');
    expect(parsed.at(-1)).toBe(`t${MAX_OPEN_ROWS + 4}`);
  });
});

describe('withRowOpen', () => {
  it('opens and closes one row without touching the others', () => {
    const a = withRowOpen(new Set(['x']), 'y', true);
    expect([...a]).toEqual(['x', 'y']);
    expect([...withRowOpen(a, 'x', false)]).toEqual(['y']);
  });

  it('is idempotent: opening an open row moves it to newest, never duplicates it', () => {
    const a = withRowOpen(new Set(['x', 'y']), 'x', true);
    expect([...a]).toEqual(['y', 'x']);
  });

  it('closing a row that is not open is a no-op', () => {
    expect([...withRowOpen(new Set(['x']), 'z', false)]).toEqual(['x']);
  });

  it('never returns the set it was given (React state must see a new object)', () => {
    const before = new Set(['x']);
    expect(withRowOpen(before, 'x', true)).not.toBe(before);
    expect([...before]).toEqual(['x']);
  });

  it('the cap is out of reach for a reader: opening the 31st row — or the 200th — closes none', () => {
    // At 30 the cap was something a reader could hit, and hitting it closed the FIRST row
    // they had opened: the page above them shrank and their row moved (critic cycle 4).
    let open: Set<string> = new Set();
    for (let i = 0; i < 200; i++) open = withRowOpen(open, 't' + i, true);
    expect(open.size).toBe(200);
    expect(open.has('t0')).toBe(true);
    expect(MAX_OPEN_ROWS).toBeGreaterThanOrEqual(200);
  });

  it('drops the oldest once the cap is reached', () => {
    let open: Set<string> = new Set();
    for (let i = 0; i < MAX_OPEN_ROWS + 3; i++) open = withRowOpen(open, `t${i}`, true);
    expect(open.size).toBe(MAX_OPEN_ROWS);
    expect(open.has('t0')).toBe(false);
    expect(open.has('t3')).toBe(true);
    expect(open.has(`t${MAX_OPEN_ROWS + 2}`)).toBe(true);
  });
});

/**
 * A row that comes back open is half of keeping the reader's place; the other half is the
 * scroll offset, which only `reloadPreservingScroll` saves. The ten row editors each
 * confirmed with a bare `window.location.reload()` — the row reopened and the reader landed
 * 3,300px away (critic cycle 3, F3). A fence by construction: an editor that renders on a
 * register row may not reload any other way.
 */
describe('every row editor confirms with the reload that keeps the reader\'s place', () => {
  const EDITORS = [
    'txn-note-form',
    'txn-tax-form',
    'txn-amount-form',
    'txn-date-form',
    'txn-account-form',
    'txn-descriptor-form',
    'txn-direction-form',
    'txn-exclude-form',
    'txn-reimbursement-form',
    'payee-name-form',
  ];

  it.each(EDITORS)('%s', (name) => {
    const src = readFileSync(join(process.cwd(), 'src/components/finance', `${name}.tsx`), 'utf8');
    expect(src).not.toMatch(/window\.location\.reload\(/);
    expect(src).toMatch(/reloadPreservingScroll\(\)/);
  });

  it('covers every control the register row imports from a *-form module', () => {
    const list = readFileSync(join(process.cwd(), 'src/components/finance/transaction-list.tsx'), 'utf8');
    const imported = [...list.matchAll(/from '@\/components\/finance\/([a-z-]+-form)'/g)].map((m) => m[1]!);
    expect(imported.length).toBeGreaterThan(0);
    for (const name of imported) expect(EDITORS, `${name} is rendered on the row but not fenced`).toContain(name);
  });
});
