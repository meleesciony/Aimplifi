/**
 * U.11g — READ-ONLY: measure the PRESCRIBED fix before writing it.
 *
 * U.11f showed 5 of the 9 provably-wrong supersessions would STILL be proposed today, each
 * on the weak NAME signal alone and each on a single generic token — "plan" pairs three
 * Schwab 529 plans with a Vanguard 401k, "lee" pairs two different cardholders' cards.
 *
 * The candidate fix is one clause: `masksDiffer` already disqualifies the weak name signal
 * (and ONLY that signal — the strong mask/balance signals survive it by design), but it
 * reads the `mask` COLUMN, which SimpleFIN never populates. Widening it to the same
 * `matchableMask` the POSITIVE path already uses — mask column, else a last-4 embedded in
 * the name — makes "Schwab 529 Plan ...-01 (01)" conflict with mask "3075".
 *
 * That widening is exactly what dup-veto critics F1/F2 refused for the GENERAL veto, on the
 * grounds that a mis-read ("Roth IRA (2021)" → 2021) would silently hide a real duplicate.
 * So this measures both directions on the owner's real corpus rather than arguing them:
 * every pair the current detector proposes, with and without the widened clause.
 *
 * Every statement is a SELECT. Writes nothing. The engine is NOT modified — the candidate
 * rule is re-implemented here so the measurement precedes the change.
 *
 *   npx tsx scripts/audit-probes/u11g-measure-the-number-veto.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { detectDuplicateAccounts, maskFromName } from '../../src/lib/engine/account/duplicates';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const money = (cents: number) =>
  `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const accounts = (
  await c.query(
    `SELECT id, "userId", name, type, subtype, mask, currency, "currentBalanceCents",
            CASE WHEN "plaidItemId" IS NOT NULL THEN 'plaid' ELSE 'simplefin' END AS provider,
            "plaidItemId"
       FROM "Account"`,
  )
).rows as {
  id: string;
  userId: string;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  currency: string | null;
  currentBalanceCents: number;
  provider: string;
  plaidItemId: string | null;
}[];
const byId = new Map(accounts.map((a) => [a.id, a]));

const stored = new Set(
  (
    await c.query(
      `SELECT "predecessorAccountId" || '|' || "successorAccountId" AS k
         FROM "AccountReconciliation" WHERE "undoneAt" IS NULL`,
    )
  ).rows.map((r) => r.k as string),
);

const toCandidate = (a: (typeof accounts)[number]) => ({
  id: a.id,
  provider: a.provider,
  name: a.name,
  type: a.type,
  mask: a.mask,
  currentBalanceCents: a.currentBalanceCents,
  currency: a.currency,
  plaidItemId: a.plaidItemId,
  subtype: a.subtype,
});

/** The candidate rule, re-implemented here: the last-4 for the weak-name VETO. */
const matchableMask = (a: { mask: string | null; name: string }) => a.mask ?? maskFromName(a.name);

console.log('='.repeat(78));
console.log('U.11g — WHAT THE WIDENED NUMBER VETO WOULD DO (production, read-only)');
console.log('='.repeat(78));

const byUser = new Map<string, typeof accounts>();
for (const a of accounts) {
  if (!byUser.has(a.userId)) byUser.set(a.userId, []);
  byUser.get(a.userId)!.push(a);
}

let suppressedNameOnly = 0;
let keptStrong = 0;
const suppressedRows: string[] = [];
const keptRows: string[] = [];

for (const [, userAccounts] of byUser) {
  const pairs = detectDuplicateAccounts(userAccounts.map(toCandidate));
  for (const p of pairs) {
    const a = byId.get(p.a.id)!;
    const b = byId.get(p.b.id)!;
    const nameOnly = p.reasons.every((r) => r.startsWith('shared name'));
    const ma = matchableMask(a);
    const mb = matchableMask(b);
    const numbersConflict = !!ma && !!mb && ma !== mb;
    const isStored = stored.has(`${a.id}|${b.id}`) || stored.has(`${b.id}|${a.id}`);
    const tag = isStored ? ' [CONFIRMED IN PRODUCTION]' : '';
    const label =
      `    ${p.confidence.padEnd(6)} ${a.name.slice(0, 34).padEnd(34)} ${money(a.currentBalanceCents).padStart(13)}\n` +
      `           ${b.name.slice(0, 34).padEnd(34)} ${money(b.currentBalanceCents).padStart(13)}\n` +
      `           reasons: ${p.reasons.join('; ')} | last-4 ${ma ?? '-'} vs ${mb ?? '-'}${tag}`;

    if (nameOnly && numbersConflict) {
      suppressedNameOnly++;
      suppressedRows.push(label);
    } else {
      keptStrong++;
      keptRows.push(label);
    }
  }
}

console.log(`\nPairs the CURRENT detector proposes: ${suppressedNameOnly + keptStrong}`);
console.log(`\n  WOULD BE SUPPRESSED by the widened veto (name-only AND conflicting last-4): ${suppressedNameOnly}`);
for (const r of suppressedRows) console.log(r);
console.log(`\n  UNCHANGED — kept (a strong signal fired, or the numbers agree/are absent): ${keptStrong}`);
for (const r of keptRows) console.log(r);

console.log('\n' + '='.repeat(78));
console.log(
  'Failure directions, both measured above rather than argued:\n' +
    '  a WRONG suppression hides a genuine duplicate → a VISIBLE double the app already discloses;\n' +
    '  a WRONG proposal, once confirmed, ZEROES a balance silently — measured at $468,840.29.',
);
console.log('='.repeat(78));

await c.end();
