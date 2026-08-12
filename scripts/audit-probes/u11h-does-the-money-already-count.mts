/**
 * U.11h — READ-ONLY: is each wrongly-superseded balance ALREADY counted somewhere else?
 *
 * U.11e proved 9 stored supersessions pair rows that advertise different account numbers,
 * and R2 zeroes a predecessor's balance — which looks like $468,840.29 removed from net
 * worth. That inference is NOT safe, and this probe exists to test it before anyone reports
 * a number: U.11g incidentally showed the owner also holds LIVE Plaid rows whose last-4s
 * match those Schwab predecessors ("Rollover IRA" 0584 next to "Schwab US Rollover IRA
 * ...584"). If the real account is already counted through its correct twin, then zeroing
 * the stale Schwab row is the RIGHT outcome reached by the wrong reasoning, the net-worth
 * total is fine, and the damage is somewhere else entirely.
 *
 * For every wrongly-superseded predecessor this reports: its balance, whether a NON-zeroed
 * account elsewhere carries a suffix-matching last-4, and that account's balance.
 *
 * Every statement is a SELECT. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u11h-does-the-money-already-count.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { maskFromName } from '../../src/lib/engine/account/duplicates';

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

/** Trailing digits a row advertises, from mask column or anywhere in the name. */
const numbersOf = (name: string, mask: string | null): string[] => {
  const out = new Set<string>();
  if (mask) out.add(mask);
  const fromName = maskFromName(name);
  if (fromName) out.add(fromName);
  for (const m of name.matchAll(/(\d{3,})/g)) out.add(m[1]);
  return [...out];
};
const suffixMatch = (a: string, b: string) => a === b || a.endsWith(b) || b.endsWith(a);

const accounts = (
  await c.query(
    `SELECT id, name, type, mask, "currentBalanceCents",
            CASE WHEN "plaidItemId" IS NOT NULL THEN 'plaid' ELSE 'simplefin' END AS provider
       FROM "Account"`,
  )
).rows as {
  id: string;
  name: string;
  type: string;
  mask: string | null;
  currentBalanceCents: number;
  provider: string;
}[];
const byId = new Map(accounts.map((a) => [a.id, a]));

const links = (
  await c.query(
    `SELECT "predecessorAccountId", "successorAccountId"
       FROM "AccountReconciliation" WHERE "undoneAt" IS NULL`,
  )
).rows;
const supersededIds = new Set(links.map((l) => l.predecessorAccountId as string));

// The 9 predecessors U.11e proved wrong, named by id so this probe states its own scope.
const WRONG_PREDECESSOR_NAMES = [
  'Chase Bank E. LEE (4034)',
  'Charles Schwab US Schwab 529 Plan ...-01 (01)',
  'Charles Schwab US Schwab 529 Plan ...-02 (02)',
  'Charles Schwab US Schwab 529 Plan ...-03 (03)',
  'Charles Schwab US Rollover IRA ...191 (191)',
  'Charles Schwab US Rollover IRA ...584 (584)',
  'Charles Schwab US Roth Contributory IRA ...156 (156)',
  'Charles Schwab US Roth Contributory IRA ...754 (754)',
  'Charles Schwab US Roth Contributory IRA ...396 (396)',
];

console.log('='.repeat(78));
console.log('U.11h — IS THE ZEROED MONEY ALREADY COUNTED VIA THE CORRECT TWIN?');
console.log('='.repeat(78));

let coveredCents = 0;
let orphanCents = 0;

for (const wname of WRONG_PREDECESSOR_NAMES) {
  const p = accounts.find((a) => a.name === wname);
  if (!p) {
    console.log(`\n${wname}\n  (no account row found — skipped)`);
    continue;
  }
  const succId = links.find((l) => l.predecessorAccountId === p.id)?.successorAccountId;
  const succ = succId ? byId.get(succId) : undefined;
  const pn = numbersOf(p.name, p.mask);

  // Candidate twins: same type, NOT superseded, not the wrong successor, sharing a number.
  const twins = accounts.filter(
    (a) =>
      a.id !== p.id &&
      a.id !== succId &&
      a.type === p.type &&
      !supersededIds.has(a.id) &&
      numbersOf(a.name, a.mask).some((n) => pn.some((m) => suffixMatch(n, m))),
  );

  console.log('\n' + '-'.repeat(78));
  console.log(`ZEROED  ${p.name}  ${money(p.currentBalanceCents)}  [${p.provider}] numbers{${pn.join(',')}}`);
  console.log(`        superseded by "${succ?.name ?? succId}" ${succ ? money(succ.currentBalanceCents) : ''}`);
  if (twins.length) {
    coveredCents += p.currentBalanceCents;
    console.log(`  ==> ALREADY COUNTED elsewhere — a live twin carries this account:`);
    for (const t of twins) {
      console.log(
        `      ${money(t.currentBalanceCents).padStart(14)}  ${t.name}  [${t.provider}] ` +
          `numbers{${numbersOf(t.name, t.mask).join(',')}}`,
      );
    }
  } else {
    orphanCents += p.currentBalanceCents;
    console.log(`  ==> NO twin found — this balance is counted NOWHERE (${money(p.currentBalanceCents)} missing)`);
  }
}

console.log('\n' + '='.repeat(78));
console.log('RESULT');
console.log(`  zeroed but ALREADY counted through a correct live twin : ${money(coveredCents)}`);
console.log(`  zeroed and counted NOWHERE (genuinely missing money)   : ${money(orphanCents)}`);
console.log(
  `\n  A balance in the first bucket means the wrong link reaches the RIGHT total by the\n` +
    `  wrong reasoning: the stale row should indeed stop counting, just not because it is\n` +
    `  "the same account as" the row it was paired with. The harm there is attribution and\n` +
    `  history, not the headline figure.`,
);
console.log('='.repeat(78));

await c.end();
