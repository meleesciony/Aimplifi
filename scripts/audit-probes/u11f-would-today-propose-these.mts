/**
 * U.11f — READ-ONLY: would TODAY's detector still propose the 9 links U.11e proved wrong?
 *
 * The 9 wrong supersessions were all confirmed on 2026-07-24 between 21:24 and 21:30, and
 * `duplicateSignals` carries a registration veto whose own docblock cites an owner report
 * from that same date ("one SimpleFIN Roth IRA was offered against BOTH a Plaid Roth and a
 * Plaid Traditional"). So the code may already refuse these — in which case the defect that
 * remains is not the proposer but the 9 rows sitting in the database, which no shipped path
 * re-examines (docs/lessons/prevention-is-not-a-remedy.md).
 *
 * This replays the CURRENT `detectReconciliationCandidates` inputs through the CURRENT
 * `duplicateSignals` for exactly the pairs production actually stored, using the real account
 * rows, and prints whether each would be proposed today and with what signal.
 *
 * Every statement is a SELECT. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u11f-would-today-propose-these.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { detectDuplicateAccounts } from '../../src/lib/engine/account/duplicates';
import { accountRegistration, registrationsConflict } from '../../src/lib/engine/account/registration';

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

const links = (
  await c.query(
    `SELECT "predecessorAccountId", "successorAccountId", "matchSignal", confidence, "confirmedByUserAt"
       FROM "AccountReconciliation" WHERE "undoneAt" IS NULL ORDER BY "confirmedByUserAt"`,
  )
).rows;

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

console.log('='.repeat(78));
console.log("U.11f — WOULD TODAY'S DETECTOR PROPOSE PRODUCTION'S STORED LINKS?");
console.log('='.repeat(78));

let stillProposed = 0;
let nowRefused = 0;

for (const l of links) {
  const p = byId.get(l.predecessorAccountId);
  const s = byId.get(l.successorAccountId);
  if (!p || !s) continue;

  // Run the SHIPPED detector over exactly this pair.
  const pairs = detectDuplicateAccounts([toCandidate(p), toCandidate(s)]);
  const proposed = pairs.length > 0;
  const regP = accountRegistration({ type: p.type, subtype: p.subtype, name: p.name });
  const regS = accountRegistration({ type: s.type, subtype: s.subtype, name: s.name });
  const vetoed = registrationsConflict(
    { type: p.type, subtype: p.subtype, name: p.name },
    { type: s.type, subtype: s.subtype, name: s.name },
  );

  console.log('\n' + '-'.repeat(78));
  console.log(`STORED signal=${l.matchSignal}/${l.confidence} confirmed=${l.confirmedByUserAt?.toISOString?.().slice(0, 19)}`);
  console.log(`  PRED ${p.name}  [${money(p.currentBalanceCents)}]  registration=${regP ?? 'unknown'}`);
  console.log(`  SUCC ${s.name}  [${money(s.currentBalanceCents)}]  registration=${regS ?? 'unknown'}`);
  if (proposed) {
    stillProposed++;
    console.log(
      `  TODAY  *** STILL PROPOSED *** ${pairs[0].confidence} — ${pairs[0].reasons.join('; ')}`,
    );
  } else {
    nowRefused++;
    console.log(`  TODAY  refused${vetoed ? ' (registration conflict veto)' : ' (no positive signal survives)'}`);
  }
}

console.log('\n' + '='.repeat(78));
console.log(
  `Of ${stillProposed + nowRefused} stored live links whose accounts both still exist:\n` +
    `  today's detector would STILL propose : ${stillProposed}\n` +
    `  today's detector now REFUSES         : ${nowRefused}\n` +
    `\nA link the detector would no longer propose is one the app would not create today —\n` +
    `but nothing re-examines a link once it is stored, so it keeps zeroing a balance.`,
);
console.log('='.repeat(78));

await c.end();
