/**
 * Known-answer tests for the connection-health / data-staleness classifier
 * (src/lib/engine/sync/health.ts). Every day count is hand-verified against a
 * fixed today = 2026-06-10; boundaries (3/4 and 13/14 days) are pinned exactly so a
 * threshold change can never pass silently.
 */
import { describe, it, expect } from 'vitest';
import { isoDate, type ISODate } from '@/lib/dates';
import {
  classifyFreshness,
  freshnessMessage,
  summarizeDataFreshness,
  dataFreshnessBanner,
  mostRecentDate,
  perAccountFreshness,
  type AccountFreshnessInput,
  FRESH_THROUGH_DAYS,
  STALE_THROUGH_DAYS,
  type FreshnessLevel,
  classifyConnectionHealth,
  selectConnectionAlerts,
  connectionAlertMessage,
  type ConnectionHealthInput,
} from '@/lib/engine/sync/health';

const TODAY = isoDate('2026-06-10');
const d = (s: string): ISODate => isoDate(s);

describe('classifyFreshness — level + day count', () => {
  const cases: Array<{ ref: ISODate | null; days: number | null; level: FreshnessLevel; note: string }> = [
    { ref: null, days: null, level: 'unknown', note: 'never synced' },
    { ref: d('2026-06-10'), days: 0, level: 'fresh', note: 'synced today' },
    { ref: d('2026-06-09'), days: 1, level: 'fresh', note: 'yesterday' },
    { ref: d('2026-06-07'), days: 3, level: 'fresh', note: 'fresh upper boundary (3)' },
    { ref: d('2026-06-06'), days: 4, level: 'stale', note: 'stale lower boundary (4)' },
    { ref: d('2026-05-28'), days: 13, level: 'stale', note: 'stale upper boundary (13)' },
    { ref: d('2026-05-27'), days: 14, level: 'very_stale', note: 'very_stale lower boundary (14)' },
    { ref: d('2026-05-11'), days: 30, level: 'very_stale', note: 'a month stale' },
  ];

  for (const c of cases) {
    it(`${c.note}: ${c.ref ?? 'null'} → ${c.level} (${c.days})`, () => {
      const r = classifyFreshness(c.ref, TODAY);
      expect(r.level).toBe(c.level);
      expect(r.daysSince).toBe(c.days);
      expect(r.referenceDate).toBe(c.ref);
    });
  }

  it('a future reference date clamps to 0 days / fresh (never negative)', () => {
    const r = classifyFreshness(d('2026-06-12'), TODAY);
    expect(r.daysSince).toBe(0);
    expect(r.level).toBe('fresh');
  });

  it('the exported thresholds are the ones under test (guards silent drift)', () => {
    expect(FRESH_THROUGH_DAYS).toBe(3);
    expect(STALE_THROUGH_DAYS).toBe(13);
  });
});

describe('freshnessMessage — guardrail-safe copy', () => {
  it('unknown → no day count', () => {
    expect(freshnessMessage(classifyFreshness(null, TODAY))).toBe('Not synced yet');
  });
  it('today / yesterday / N days ago phrasing', () => {
    expect(freshnessMessage(classifyFreshness(d('2026-06-10'), TODAY))).toBe('Synced today');
    expect(freshnessMessage(classifyFreshness(d('2026-06-09'), TODAY))).toBe('Synced yesterday');
    expect(freshnessMessage(classifyFreshness(d('2026-06-07'), TODAY))).toBe('Synced 3 days ago');
  });
  it('stale states recency without a nudge', () => {
    expect(freshnessMessage(classifyFreshness(d('2026-06-06'), TODAY))).toBe('Last synced 4 days ago');
  });
  it('very_stale carries the reconnect nudge, phrased as "may"', () => {
    const msg = freshnessMessage(classifyFreshness(d('2026-05-27'), TODAY));
    expect(msg).toBe('No new data in 14 days — you may need to reconnect.');
    expect(msg).toMatch(/may need to reconnect/);
    expect(msg).not.toMatch(/broken|failed|error/i); // never asserts a state we can't observe
  });
});

describe('mostRecentDate — best available freshness reference (P2-1)', () => {
  it('picks the latest non-null; ignores nulls; all-null → null', () => {
    expect(mostRecentDate(d('2026-05-01'), d('2026-06-09'))).toBe(d('2026-06-09'));
    expect(mostRecentDate(d('2026-06-09'), d('2026-05-01'))).toBe(d('2026-06-09'));
    expect(mostRecentDate(null, d('2026-05-01'))).toBe(d('2026-05-01'));
    expect(mostRecentDate(d('2026-05-01'), null)).toBe(d('2026-05-01'));
    expect(mostRecentDate(null, null)).toBeNull();
  });

  it('a recent sync outranks a quiet transaction feed → no false-positive banner', () => {
    // Linked savings account: synced TODAY, but no new transactions for a month.
    // The sync running proves the feed is live, so the banner must NOT fire.
    const reference = mostRecentDate(d('2026-06-10') /* lastSyncedAt */, d('2026-05-01') /* newest txn */);
    expect(summarizeDataFreshness(reference, TODAY).shouldWarn).toBe(false);
  });

  it('a stopped sync AND no recent transactions → still warns (real staleness survives)', () => {
    const reference = mostRecentDate(d('2026-05-20') /* last sync */, d('2026-05-01') /* newest txn */);
    expect(summarizeDataFreshness(reference, TODAY).shouldWarn).toBe(true);
  });
});

describe('summarizeDataFreshness — dashboard banner gating', () => {
  it('no linked data → unknown, no warning, no banner', () => {
    const s = summarizeDataFreshness(null, TODAY);
    expect(s).toMatchObject({ level: 'unknown', daysSince: null, newestDate: null, shouldWarn: false });
    expect(dataFreshnessBanner(s)).toBeNull();
  });
  it('fresh feed → no warning, no banner', () => {
    const s = summarizeDataFreshness(d('2026-06-09'), TODAY);
    expect(s.shouldWarn).toBe(false);
    expect(dataFreshnessBanner(s)).toBeNull();
  });
  it('stale feed → warns with a soft reconnect suggestion', () => {
    const s = summarizeDataFreshness(d('2026-06-06'), TODAY);
    expect(s).toMatchObject({ level: 'stale', daysSince: 4, shouldWarn: true });
    expect(dataFreshnessBanner(s)).toBe(
      "Your linked accounts haven't shown new activity in 4 days. If that seems off, you can reconnect from the Accounts page.",
    );
  });
  it('very_stale feed → warns that a sync may have stopped', () => {
    const s = summarizeDataFreshness(d('2026-05-27'), TODAY);
    expect(s).toMatchObject({ level: 'very_stale', daysSince: 14, shouldWarn: true });
    expect(dataFreshnessBanner(s)).toBe(
      "Your linked accounts haven't shown new activity in 14 days. A sync may have stopped — check your connections on the Accounts page.",
    );
  });
});

describe('perAccountFreshness — per-row /accounts freshness (today = 2026-06-10)', () => {
  // A helper that fills the defaults so each case names only the field it exercises.
  const acct = (over: Partial<AccountFreshnessInput> & { id: string }): AccountFreshnessInput => ({
    isLinkedFeed: true,
    type: 'CHECKING',
    newestTxnDate: null,
    connectionLastSyncedAt: null,
    ...over,
  });

  it('non-linked accounts (manual/demo) never get a freshness result', () => {
    const out = perAccountFreshness(
      [acct({ id: 'manual', isLinkedFeed: false, newestTxnDate: d('2026-06-10') })],
      TODAY,
    );
    expect(out.manual).toBeNull();
  });

  it('INVESTMENT accounts are excluded even when linked (holdings-valued, no txn feed)', () => {
    const out = perAccountFreshness(
      [acct({ id: 'brk', type: 'INVESTMENT', newestTxnDate: d('2026-06-10') })],
      TODAY,
    );
    expect(out.brk).toBeNull();
  });

  it('a linked account with a recent transaction reads fresh', () => {
    const out = perAccountFreshness([acct({ id: 'chk', newestTxnDate: d('2026-06-09') })], TODAY);
    expect(out.chk).toMatchObject({ level: 'fresh', daysSince: 1 });
  });

  it('a linked account whose newest txn is old but connection synced recently reads fresh (quiet-account guard)', () => {
    // Newest txn 2026-05-01 (40 days → very_stale on its own), but the connection synced
    // 2026-06-09 (1 day) → mostRecentDate wins → fresh, no false reconnect nudge.
    const out = perAccountFreshness(
      [acct({ id: 'sav', newestTxnDate: d('2026-05-01'), connectionLastSyncedAt: d('2026-06-09') })],
      TODAY,
    );
    expect(out.sav).toMatchObject({ level: 'fresh', daysSince: 1, referenceDate: d('2026-06-09') });
  });

  it('a linked account stale on BOTH signals grades very_stale', () => {
    const out = perAccountFreshness(
      [acct({ id: 'chk', newestTxnDate: d('2026-05-01'), connectionLastSyncedAt: d('2026-05-01') })],
      TODAY,
    );
    expect(out.chk?.level).toBe('very_stale');
    expect(freshnessMessage(out.chk!)).toContain('you may need to reconnect');
  });

  it('a linked account with no txns and no sync stamp is unknown ("Not synced yet")', () => {
    const out = perAccountFreshness([acct({ id: 'new' })], TODAY);
    expect(out.new).toMatchObject({ level: 'unknown', daysSince: null });
    expect(freshnessMessage(out.new!)).toBe('Not synced yet');
  });

  it('classifies every account in one pass, keyed by id', () => {
    const out = perAccountFreshness(
      [
        acct({ id: 'a', newestTxnDate: d('2026-06-10') }),
        acct({ id: 'b', isLinkedFeed: false }),
        acct({ id: 'c', type: 'INVESTMENT' }),
      ],
      TODAY,
    );
    expect(Object.keys(out).sort()).toEqual(['a', 'b', 'c']);
    expect(out.a?.level).toBe('fresh');
    expect(out.b).toBeNull();
    expect(out.c).toBeNull();
  });
});

describe('classifyConnectionHealth — broken ONLY from a persisted error (Gap 1 §4)', () => {
  const conn = (over: Partial<ConnectionHealthInput>): ConnectionHealthInput => ({
    connectionId: 'c1',
    provider: 'SimpleFIN',
    institution: null,
    lastSyncAttemptAt: null,
    lastSyncError: null,
    ...over,
  });

  it('never attempted → unknown (not a warning)', () => {
    const r = classifyConnectionHealth(conn({}), TODAY);
    expect(r.state).toBe('unknown');
    expect(r.daysSinceAttempt).toBeNull();
  });

  it('attempted, no error → ok', () => {
    const r = classifyConnectionHealth(conn({ lastSyncAttemptAt: d('2026-06-08') }), TODAY);
    expect(r.state).toBe('ok');
    expect(r.daysSinceAttempt).toBe(2);
  });

  it('a recorded error → broken, regardless of how recent the attempt was', () => {
    const r = classifyConnectionHealth(
      conn({ lastSyncAttemptAt: d('2026-06-10'), lastSyncError: 'auth' }),
      TODAY,
    );
    expect(r.state).toBe('broken');
    expect(r.daysSinceAttempt).toBe(0);
  });

  it('CRITICAL: a very old attempt with NO error is still ok, never broken (no recency inference)', () => {
    // 40 days since the last attempt would be "very_stale" for freshness, but with no
    // recorded failure the connection is NOT broken — the two questions are independent.
    const r = classifyConnectionHealth(conn({ lastSyncAttemptAt: d('2026-05-01') }), TODAY);
    expect(r.state).toBe('ok');
  });

  it('a future attempt stamp clamps daysSinceAttempt to 0', () => {
    const r = classifyConnectionHealth(conn({ lastSyncAttemptAt: d('2026-06-12'), lastSyncError: 'server' }), TODAY);
    expect(r.daysSinceAttempt).toBe(0);
    expect(r.state).toBe('broken');
  });
});

describe('selectConnectionAlerts — one alert per broken connection, deterministic order', () => {
  it('empty input → no alerts', () => {
    expect(selectConnectionAlerts([], TODAY)).toEqual([]);
  });

  it('healthy + never-synced connections yield nothing (demo-safe, no false alarm)', () => {
    const alerts = selectConnectionAlerts(
      [
        { connectionId: 'ok', provider: 'SimpleFIN', institution: null, lastSyncAttemptAt: d('2026-06-10'), lastSyncError: null },
        { connectionId: 'new', provider: 'Plaid', institution: 'Chase', lastSyncAttemptAt: null, lastSyncError: null },
      ],
      TODAY,
    );
    expect(alerts).toEqual([]);
  });

  it('only broken connections surface, sorted by provider then id', () => {
    const alerts = selectConnectionAlerts(
      [
        { connectionId: 'z', provider: 'SimpleFIN', institution: null, lastSyncAttemptAt: d('2026-06-09'), lastSyncError: 'network' },
        { connectionId: 'ok', provider: 'SimpleFIN', institution: null, lastSyncAttemptAt: d('2026-06-10'), lastSyncError: null },
        { connectionId: 'a', provider: 'Plaid', institution: 'Chase', lastSyncAttemptAt: d('2026-06-08'), lastSyncError: 'auth' },
      ],
      TODAY,
    );
    expect(alerts.map((a) => a.connectionId)).toEqual(['a', 'z']); // Plaid < SimpleFIN, then id
    expect(alerts[0].provider).toBe('Plaid');
  });

  it('the alert message never echoes the raw error text and names the fix', () => {
    const alerts = selectConnectionAlerts(
      [{ connectionId: 'c', provider: 'SimpleFIN', institution: null, lastSyncAttemptAt: d('2026-06-06'), lastSyncError: 'a-secret-url-token' }],
      TODAY,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).not.toContain('a-secret-url-token');
    expect(alerts[0].message).toMatch(/Reconnect it on the Accounts page/);
  });
});

describe('connectionAlertMessage — guardrail-safe copy', () => {
  const base = { connectionId: 'c', provider: 'SimpleFIN', institution: null, state: 'broken' as const };
  it('names the institution when known', () => {
    expect(connectionAlertMessage({ ...base, provider: 'Plaid', institution: 'Chase', daysSinceAttempt: 2 })).toBe(
      "Your Chase (Plaid) connection couldn't sync for 2 days. Reconnect it on the Accounts page so your numbers stay current.",
    );
  });
  it('today / yesterday phrasing without an institution', () => {
    expect(connectionAlertMessage({ ...base, daysSinceAttempt: 0 })).toContain('in the latest sync');
    expect(connectionAlertMessage({ ...base, daysSinceAttempt: 1 })).toContain('since yesterday');
  });
  it('no blame or shame language', () => {
    const msg = connectionAlertMessage({ ...base, daysSinceAttempt: 5 });
    expect(msg).not.toMatch(/you (failed|forgot|didn't)/i);
  });
});
