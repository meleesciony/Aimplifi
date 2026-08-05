/**
 * H.5 SCALE PROBE — the task row's explicit pre-ship gate: *"Verify the dedupe
 * holds at 1095d scale before shipping: the incremental path assumes a 5-day
 * overlap; a full re-pull overlaps EVERYTHING already stored, and duplicate rows
 * corrupt every total."*
 *
 * GATED OFF BY DEFAULT (`H5_SCALE_PROBE=1` to run). It ingests thousands of rows
 * and is a timing measurement as much as an assertion, so it does not belong in
 * the per-commit suite — the behavioural locks live in
 * simplefin-history-backfill{,-server}.test.ts and always run. This one answers a
 * different question: does the add-only claim survive the volume a real
 * three-year backfill actually moves, and what does it cost?
 *
 *   H5_SCALE_PROBE=1 npx vitest run tests/unit/simplefin-history-backfill-scale.test.ts
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { syncSimplefinNow } from '@/server/simplefin-actions';
import { encryptToken } from '@/lib/crypto';
import { addDays, isoDate, toEpochDays } from '@/lib/dates';
import { prisma } from '@/lib/db';

const ROWS = Number(process.env.H5_SCALE_ROWS ?? 3000);
const TODAY = isoDate('2026-06-10');
const ACCESS_URL = 'https://ro-user:secret@bridge.example/simplefin';
const KEY = Buffer.alloc(32, 7).toString('base64');

/** Three years of plausible spending: ~1090 days, 40 recurring merchants. */
function buildTxns() {
  const merchants = Array.from({ length: 40 }, (_, i) => `MERCHANT ${i} STORE #${100 + i}`);
  return Array.from({ length: ROWS }, (_, i) => ({
    id: `scale-${i}`,
    posted: toEpochDays(addDays(TODAY, -Math.floor((i / ROWS) * 1088) - 2)) * 86400,
    amount: `-${(10 + (i % 400) / 4).toFixed(2)}`,
    description: merchants[i % merchants.length],
  }));
}

describe.runIf(process.env.H5_SCALE_PROBE === '1')(
  `H.5 dedupe at 1095-day scale (${ROWS} rows)`,
  () => {
    const USER = `sf-scale-${Date.now()}-${process.pid}`;
    let accountId: string;
    let fetches = 0;
    let deepestRequest = Number.POSITIVE_INFINITY;

    async function wipe() {
      await prisma.user.deleteMany({ where: { id: USER } });
    }

    beforeAll(async () => {
      // beforeEach has not run yet, and this hook encrypts the access URL.
      process.env.DATA_ENCRYPTION_KEY = KEY;
      await wipe();
      await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
      await prisma.simpleFinConnection.create({
        data: {
          userId: USER,
          accessUrl: encryptToken(ACCESS_URL),
          lastSyncedAt: addDays(TODAY, -2), // an EXISTING connection — the owner's shape
          historyBackfilledAt: null,
        },
      });
      const acct = await prisma.account.create({
        data: {
          userId: USER,
          provider: 'simplefin',
          providerRef: 'acc-1',
          name: 'Checking',
          type: 'CHECKING',
          currentBalanceCents: 340000,
        },
      });
      accountId = acct.id;
    });
    afterAll(wipe);
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
      vi.stubEnv('DATA_ENCRYPTION_KEY', KEY);
      vi.stubEnv('DEMO_TODAY', TODAY);
      vi.stubEnv('XAI_API_KEY', '');
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      const all = buildTxns();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: unknown) => {
          fetches++;
          // Honour the requested start-date, as a real bridge does. Without this the
          // 5-day incremental pass would re-send all three years and drive 3000 rows
          // through `guardedVerdictRefresh` — measured once, and it does not survive
          // it. That is the failure mode this whole slice exists to route around, so
          // the probe must not accidentally depend on it.
          const startEpoch = Number(new URL(String(input)).searchParams.get('start-date'));
          const transactions = all.filter((t) => t.posted >= startEpoch);
          deepestRequest = Math.min(deepestRequest, startEpoch);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              accounts: [
                { id: 'acc-1', name: 'Checking', balance: '3400.00', org: { name: 'My Bank' }, transactions },
              ],
            }),
          } as Response;
        }),
      );
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('converges to the full history across capped runs, then adds nothing on a forced re-plan', async () => {
      // The backfill is capped per run (BACKFILL_MAX_ROWS_PER_RUN) so a serverless
      // timeout can never cost a whole run's work. At scale that means the history
      // arrives over SEVERAL syncs — so the property to prove is convergence: each
      // run commits progress, none duplicates, and the flag lands only at the end.
      const t0 = Date.now();
      let runs = 0;
      let totalAdded = 0;
      for (;;) {
        await prisma.rateLimit.deleteMany({ where: { key: `sync-simplefin:${USER}` } });
        const r = await syncSimplefinNow();
        runs++;
        totalAdded += r.added ?? 0;
        const c = await prisma.simpleFinConnection.findUnique({ where: { userId: USER } });
        if (c?.historyBackfilledAt) break;
        expect(runs).toBeLessThan(50); // must converge, not spin
      }
      const ms1 = Date.now() - t0;
      const first = { added: totalAdded, runs };
      const stored = await prisma.transaction.count({ where: { accountId } });
      expect(stored).toBe(ROWS);

      const before = await prisma.transaction.findMany({
        where: { accountId },
        orderBy: { providerRef: 'asc' },
      });

      // The flag is set, so an ordinary sync must not refetch the deep window.
      const fetchesAfterFirst = fetches;
      await prisma.rateLimit.deleteMany({ where: { key: `sync-simplefin:${USER}` } });
      const second = await syncSimplefinNow();
      expect(second.added).toBe(0);

      // Now the worst case the task row names: force the ENTIRE 1090-day window to
      // re-plan against a history that is already completely stored.
      await prisma.simpleFinConnection.update({
        where: { userId: USER },
        data: { historyBackfilledAt: null },
      });
      await prisma.rateLimit.deleteMany({ where: { key: `sync-simplefin:${USER}` } });
      const t2 = Date.now();
      const forced = await syncSimplefinNow();
      const ms3 = Date.now() - t2;

      const after = await prisma.transaction.findMany({
        where: { accountId },
        orderBy: { providerRef: 'asc' },
      });

      // (1) nothing was added a second time
      expect(forced.added).toBe(0);
      expect(after).toHaveLength(ROWS);
      // (2) no duplicate provider refs
      expect(new Set(after.map((r) => r.providerRef)).size).toBe(ROWS);
      // (3) not one stored row changed in any column
      const drifted = after.filter((row, i) => JSON.stringify(row) !== JSON.stringify(before[i]));
      expect(drifted.map((d) => d.providerRef)).toEqual([]);

      console.log(
        [
          '',
          `H.5 SCALE PROBE — ${ROWS} rows over ~1090 days`,
          '─────────────────────────────────────────────',
          `converge (${first.runs} capped runs)  added=${first.added}  ${ms1}ms  (${(ms1 / ROWS).toFixed(2)}ms/row)`,
          `next sync (flag set)        added=${second.added}  requests=${fetches - fetchesAfterFirst}`,
          `forced full 1090d replan    added=${forced.added}  ${ms3}ms`,
          `duplicates=0  drifted rows=${drifted.length}`,
          '',
        ].join('\n'),
      );
    }, 900_000);
  },
);
