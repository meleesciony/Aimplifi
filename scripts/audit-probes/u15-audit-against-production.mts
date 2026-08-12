/**
 * U.15 — READ-ONLY: run the SHIPPED `auditConfirmedLinks` engine over production.
 *
 * The engine's unit tests use production-SHAPED fixtures; this runs it over the production rows
 * themselves and checks it against the independent per-link verdict U.11e reached by a completely
 * different method (transaction agreement inside the overlap + account numbers + balance gap).
 * Agreement between two methods that share no code is the point.
 *
 * Every statement is a SELECT. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u15-audit-against-production.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { auditConfirmedLinks, unsupportedLinkCount } from '../../src/lib/engine/account/link-audit';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const accounts = (
  await c.query(
    `SELECT id, "userId", name, type, subtype, mask, currency, "currentBalanceCents",
            CASE WHEN "plaidItemId" IS NOT NULL THEN 'plaid' ELSE 'simplefin' END AS provider,
            "plaidItemId"
       FROM "Account"`,
  )
).rows as Record<string, never>[] as unknown as {
  id: string; userId: string; name: string; type: string; subtype: string | null;
  mask: string | null; currency: string | null; currentBalanceCents: number;
  provider: string; plaidItemId: string | null;
}[];

const links = (
  await c.query(
    `SELECT id, "userId", "predecessorAccountId", "successorAccountId", "cutoverDate",
            "matchSignal", confidence
       FROM "AccountReconciliation" WHERE "undoneAt" IS NULL`,
  )
).rows as {
  id: string; userId: string; predecessorAccountId: string; successorAccountId: string;
  cutoverDate: string; matchSignal: string; confidence: string;
}[];

// The 9 U.11e proved wrong by an INDEPENDENT method (0% transaction agreement in the overlap
// and/or conflicting account numbers, judged per link, sharing no code with the audit engine).
const WRONG_PREDECESSORS = new Set([
  'Chase Bank E. LEE (4034)',
  'Charles Schwab US Schwab 529 Plan ...-01 (01)',
  'Charles Schwab US Schwab 529 Plan ...-02 (02)',
  'Charles Schwab US Schwab 529 Plan ...-03 (03)',
  'Charles Schwab US Rollover IRA ...191 (191)',
  'Charles Schwab US Rollover IRA ...584 (584)',
  'Charles Schwab US Roth Contributory IRA ...156 (156)',
  'Charles Schwab US Roth Contributory IRA ...754 (754)',
  'Charles Schwab US Roth Contributory IRA ...396 (396)',
]);

const userId = links[0].userId;
const userAccounts = accounts.filter((a) => a.userId === userId);
const rows = auditConfirmedLinks(
  userAccounts,
  links.filter((l) => l.userId === userId),
);

console.log('='.repeat(78));
console.log('U.15 — auditConfirmedLinks OVER PRODUCTION');
console.log('='.repeat(78));
for (const r of rows) {
  console.log(
    `\n[${r.verdict.toUpperCase()}] ${r.predecessorName ?? '(missing)'}\n` +
      `     -> ${r.successorName ?? '(missing)'}\n` +
      `     ${r.evidence.join(' | ')}`,
  );
}

const flagged = new Set(
  rows.filter((r) => r.verdict === 'unsupported').map((r) => r.predecessorName ?? ''),
);
const missed = [...WRONG_PREDECESSORS].filter((n) => !flagged.has(n));
const extra = [...flagged].filter((n) => !WRONG_PREDECESSORS.has(n));

console.log('\n' + '='.repeat(78));
console.log(`links audited ${rows.length}; flagged unsupported ${unsupportedLinkCount(rows)}`);
console.log(`  independently-proven-wrong links NOT flagged (false negatives): ${missed.length}`);
for (const n of missed) console.log(`      MISSED ${n}`);
console.log(`  flagged links NOT in the proven-wrong set (needs a look): ${extra.length}`);
for (const n of extra) console.log(`      EXTRA  ${n}`);
console.log(
  missed.length === 0 && extra.length === 0
    ? '\n  The audit engine and the independent per-link method AGREE exactly.'
    : '\n  The two methods DISAGREE — the difference is the finding, not the noise.',
);
console.log('='.repeat(78));

await c.end();
