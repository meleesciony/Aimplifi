import { describe, expect, it } from 'vitest';
import { isPostgresUrl, makeAdapter } from '@/lib/db-adapter';

describe('db-adapter — connection-string scheme detection (DECISIONS #35)', () => {
  it('treats postgres:// and postgresql:// as Postgres', () => {
    expect(isPostgresUrl('postgres://u:p@host/db')).toBe(true);
    expect(isPostgresUrl('postgresql://u:p@host/db?sslmode=require')).toBe(true);
    expect(isPostgresUrl('POSTGRESQL://u:p@host/db')).toBe(true);
  });

  it('treats sqlite file URLs and empties as NOT Postgres (zero-credential demo)', () => {
    expect(isPostgresUrl('file:./dev.db')).toBe(false);
    expect(isPostgresUrl(undefined)).toBe(false);
    expect(isPostgresUrl(null)).toBe(false);
    expect(isPostgresUrl('')).toBe(false);
  });

  it('does not mistake a merchant/host substring for a scheme', () => {
    // only the URL scheme decides — not the presence of "postgres" elsewhere
    expect(isPostgresUrl('file:./postgres-notes.db')).toBe(false);
  });

  it('builds a better-sqlite3 adapter for the default/SQLite path', () => {
    const a = makeAdapter(undefined);
    // Prisma names the instance ...AdapterFactory; match the driver, not the suffix.
    expect(a.constructor.name).toMatch(/Sqlite/i);
    expect(a.constructor.name).not.toMatch(/Pg/);
  });

  it('builds a pg adapter for a Postgres URL', () => {
    // Constructing the adapter does not open a connection, so this is safe offline.
    const a = makeAdapter('postgresql://u:p@localhost:5432/pulse?sslmode=require');
    expect(a.constructor.name).toMatch(/Pg/);
    expect(a.constructor.name).not.toMatch(/Sqlite/i);
  });
});
