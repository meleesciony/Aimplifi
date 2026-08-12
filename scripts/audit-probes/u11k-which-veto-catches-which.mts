/**
 * U.11k — READ-ONLY: which candidate veto actually catches which of the 9 wrong links?
 *
 * TASKS U.14 asserts that widening `masksDiffer` to the existing `matchableMask` would stop
 * the app proposing "three Schwab 529 plans against a Vanguard 401k". That assertion is
 * SUSPECT and this probe exists to test it before a line of engine code moves: `maskFromName`
 * only parses a PARENTHESIZED 4-digit group or a mask-prefixed 4-digit run, and the SimpleFIN
 * rows in question render as "Charles Schwab US Rollover IRA ...191 (191)" — THREE digits. So
 * `matchableMask` most likely returns null for exactly the accounts the claim is about, and
 * the widening would catch none of them.
 *
 * Compares three rules over the 9 links U.11e proved wrong, over every pair the detector
 * currently proposes, and over the 8 links it judged genuine (the false-veto cost):
 *   A. today's shipped detector (registration veto included);
 *   B. + widen the name-signal veto to `matchableMask` (the U.14 row's claim);
 *   C. + a veto on ADVERTISED ACCOUNT NUMBERS: digit groups of 3+ from mask or name,
 *      conflicting when both sides advertise some and none match by SUFFIX
 *      (Schwab "...383" vs Plaid mask "7383" is a MATCH, not a conflict).
 *
 * Every statement is a SELECT. The engine is NOT modified; each rule is re-implemented here.
 *
 *   npx tsx scripts/audit-probes/u11k-which-veto-catches-which.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { detectDuplicateAccounts, maskFromName } from '../../src/lib/engine/account/duplicates';

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
).rows as {
  id: string; userId: string; name: string; type: string; subtype: string | null;
  mask: string | null; currency: string | null; currentBalanceCents: number;
  provider: string; plaidItemId: string | null;
}[];
const byId = new Map(accounts.map((a) => [a.id, a]));

const links = (
  await c.query(
    `SELECT "predecessorAccountId", "successorAccountId" FROM "AccountReconciliation" WHERE "undoneAt" IS NULL`,
  )
).rows as { predecessorAccountId: string; successorAccountId: string }[];

const WRONG = new Set([
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

const toCandidate = (a: (typeof accounts)[number]) => ({
  id: a.id, provider: a.provider, name: a.name, type: a.type, mask: a.mask,
  currentBalanceCents: a.currentBalanceCents, currency: a.currency,
  plaidItemId: a.plaidItemId, subtype: a.subtype,
});

// Rule B: today's matchableMask
const matchableMask = (a: { mask: string | null; name: string }) => a.mask ?? maskFromName(a.name);
const vetoB = (p: (typeof accounts)[number], s: (typeof accounts)[number]) => {
  const mp = matchableMask(p);
  const ms = matchableMask(s);
  return !!mp && !!ms && mp !== ms;
};

// Rule C: advertised account numbers, suffix-compared
const advertised = (a: { mask: string | null; name: string }): string[] => {
  const out = new Set<string>();
  if (a.mask) out.add(a.mask);
  for (const m of a.name.matchAll(/(\d{3,})/g)) out.add(m[1]);
  return [...out];
};

// Rule D: only digits rendered the way an ACCOUNT NUMBER is rendered — the mask column, a
// parenthesized group, or a group behind a truncation prefix ("...383", "····4034", "-01").
// Rule C's bare \d{3,} sweep reads "529" out of "Schwab 529 Plan" and "401" out of "401k":
// product names, not account numbers. It reaches the right verdict on this corpus for the
// wrong reason, and a rule that is right by accident is a rule that breaks silently later.
const accountNumbers = (a: { mask: string | null; name: string }): string[] => {
  const out = new Set<string>();
  if (a.mask) out.add(a.mask);
  for (const m of a.name.matchAll(/\((\d{2,})\)/g)) out.add(m[1]);
  for (const m of a.name.matchAll(/(?:[•·*#]|\.{2,}|…)-?(\d{2,})\b/g)) out.add(m[1]);
  return [...out];
};
const vetoD = (p: (typeof accounts)[number], s: (typeof accounts)[number]) => {
  const ap = accountNumbers(p);
  const as = accountNumbers(s);
  if (!ap.length || !as.length) return false;
  return !ap.some((x) => as.some((y) => suffixMatch(x, y)));
};
const suffixMatch = (x: string, y: string) => x === y || x.endsWith(y) || y.endsWith(x);
const vetoC = (p: (typeof accounts)[number], s: (typeof accounts)[number]) => {
  const ap = advertised(p);
  const as = advertised(s);
  if (!ap.length || !as.length) return false;
  return !ap.some((x) => as.some((y) => suffixMatch(x, y)));
};

const proposedToday = (p: (typeof accounts)[number], s: (typeof accounts)[number]) => {
  const pairs = detectDuplicateAccounts([toCandidate(p), toCandidate(s)]);
  if (!pairs.length) return null;
  return pairs[0];
};

console.log('='.repeat(78));
console.log('U.11k — WHICH VETO CATCHES WHICH (production, read-only)');
console.log('='.repeat(78));

console.log('\nTHE 9 LINKS U.11e PROVED WRONG:');
let aCatch = 0, bCatch = 0, cCatch = 0, dCatch = 0;
for (const l of links) {
  const p = byId.get(l.predecessorAccountId);
  const s = byId.get(l.successorAccountId);
  if (!p || !s || !WRONG.has(p.name)) continue;
  const pair = proposedToday(p, s);
  const nameOnly = pair ? pair.reasons.every((r) => r.startsWith('shared name')) : false;
  const a = pair === null;                       // already refused today
  const b = !a && nameOnly && vetoB(p, s);       // widened matchableMask veto
  const cc = !a && nameOnly && vetoC(p, s);      // advertised-number veto
  const d = !a && nameOnly && vetoD(p, s);      // account-number-rendering veto
  if (a) aCatch++;
  if (a || b) bCatch++;
  if (a || cc) cCatch++;
  if (a || d) dCatch++;
  console.log(
    `  ${a ? 'A' : '.'}${a || b ? 'B' : '.'}${a || cc ? 'C' : '.'}${a || d ? 'D' : '.'}  ${p.name.slice(0, 42).padEnd(42)}` +
      `\n         -> ${s.name.slice(0, 44)}` +
      `\n         matchableMask ${matchableMask(p) ?? 'null'} vs ${matchableMask(s) ?? 'null'} | ` +
      `acctNo {${accountNumbers(p).join(',')}} vs {${accountNumbers(s).join(',')}}` +
      (pair ? ` | today: ${pair.reasons.join('; ')}` : ' | today: REFUSED'),
  );
}
console.log(
  `\n  caught by A (shipped today)          : ${aCatch}/9\n` +
    `  caught by A+B (widen matchableMask)  : ${bCatch}/9\n` +
    `  caught by A+C (advertised numbers)   : ${cCatch}/9
` +
    `  caught by A+D (account-number form)  : ${dCatch}/9`,
);

// False-veto cost: what would C suppress among links U.11e judged GENUINE?
console.log('\nGENUINE links — would rule C wrongly veto any? (the false-veto cost)');
let genuineHarmed = 0;
for (const l of links) {
  const p = byId.get(l.predecessorAccountId);
  const s = byId.get(l.successorAccountId);
  if (!p || !s || WRONG.has(p.name)) continue;
  const pair = proposedToday(p, s);
  if (!pair) continue;
  const nameOnly = pair.reasons.every((r) => r.startsWith('shared name'));
  if (nameOnly && vetoD(p, s)) {
    genuineHarmed++;
    console.log(
      `  *** WOULD SUPPRESS  ${p.name} -> ${s.name}\n` +
        `      acctNo {${accountNumbers(p).join(',')}} vs {${accountNumbers(s).join(',')}} | ${pair.reasons.join('; ')}`,
    );
  }
}
console.log(`  genuine links rule D would suppress: ${genuineHarmed}`);

// Corpus-wide effect
const byUser = new Map<string, typeof accounts>();
for (const a of accounts) {
  if (!byUser.has(a.userId)) byUser.set(a.userId, []);
  byUser.get(a.userId)!.push(a);
}
let total = 0, supprB = 0, supprC = 0, supprD = 0;
for (const [, ua] of byUser) {
  for (const pr of detectDuplicateAccounts(ua.map(toCandidate))) {
    total++;
    const x = byId.get(pr.a.id)!;
    const y = byId.get(pr.b.id)!;
    const nameOnly = pr.reasons.every((r) => r.startsWith('shared name'));
    if (nameOnly && vetoB(x, y)) supprB++;
    if (nameOnly && vetoC(x, y)) supprC++;
    if (nameOnly && vetoD(x, y)) supprD++;
    if (nameOnly && vetoD(x, y)) supprD++;
  }
}
console.log(
  `\nCORPUS: detector proposes ${total} pairs today; rule B suppresses ${supprB}, rule C ${supprC}, rule D ${supprD}.`,
);
console.log('='.repeat(78));

await c.end();
