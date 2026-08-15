/**
 * U.7 — READ-ONLY: does any reconciled collision disagree on asset vs liability?
 *
 * The U.6 critic filed this as a shape: after the row carries its own class,
 * `keepsSnapshot` drops one side of an exact-date collision and the survivor's
 * RECORDED class signs that date. Pre-U.6 both sides were signed from today's
 * type, and `effectiveReconciliationLinks` only requires today's types to match.
 * A pair that once disagreed across the asset/liability line, then healed,
 * would make the point's sign depend on who won.
 *
 * This is a prediction, not a measurement. The probe runs the real boundary
 * over the owner's real rows and counts collisions whose resolved classes
 * disagree. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u7-collision-sign.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  applyReconciliationBoundary,
  effectiveReconciliationLinks,
  terminalSuccessorMap,
} from '../../src/lib/engine/account/reconcile-boundary';
import { isLiabilityType } from '../../src/lib/engine/transactions/query';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${(Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

const accounts = (
  await c.query(
    `SELECT id, "userId", name, type, "currentBalanceCents", "feedDroppedAt" FROM "Account"`,
  )
).rows as {
  id: string;
  userId: string;
  name: string;
  type: string;
  currentBalanceCents: number;
  feedDroppedAt: string | null;
}[];
const byId = new Map(accounts.map((a) => [a.id, a]));

const links = (
  await c.query(
    `SELECT "userId", "predecessorAccountId", "successorAccountId", "cutoverDate"
       FROM "AccountReconciliation" WHERE "undoneAt" IS NULL`,
  )
).rows as {
  userId: string;
  predecessorAccountId: string;
  successorAccountId: string;
  cutoverDate: string;
}[];

const snaps = (
  await c.query(`SELECT "accountId", date, "balanceCents", "accountType" FROM "BalanceSnapshot"`)
).rows as { accountId: string; date: string; balanceCents: number; accountType: string | null }[];

const userId = links[0]?.userId;
if (!userId) {
  console.log('no live reconciliation links');
  await c.end();
  process.exit(0);
}

const userAccounts = accounts.filter((a) => a.userId === userId);
const ids = new Set(userAccounts.map((a) => a.id));
const userLinks = links.filter((l) => l.userId === userId);
const userSnaps = snaps.filter((s) => ids.has(s.accountId));

const resolvedType = (accountId: string, recorded: string | null): string => {
  const acct = byId.get(accountId);
  if (!acct) return recorded ?? '';
  return recorded === null || recorded === '' ? acct.type : recorded;
};

const eff = effectiveReconciliationLinks(userAccounts, userLinks);
const inert = userLinks.filter(
  (l) => !eff.some((e) => e.predecessorAccountId === l.predecessorAccountId && e.successorAccountId === l.successorAccountId),
);

const terminalOf = terminalSuccessorMap(userAccounts, userLinks);
const componentOf = (accountId: string): string => terminalOf.get(accountId) ?? accountId;

const out = applyReconciliationBoundary({
  paymentAccountId: null,
  accounts: userAccounts,
  links: userLinks,
  transactions: [],
  balanceSnapshots: userSnaps,
  statements: [],
  scheduled: [],
});
const kept = new Set(out.balanceSnapshots.map((s) => `${s.accountId}|${s.date}`));

type Candidate = {
  accountId: string;
  name: string;
  date: string;
  balanceCents: number;
  recorded: string | null;
  resolved: string;
  liability: boolean;
  currentType: string;
  won: boolean;
};

const collisions = new Map<string, Candidate[]>();
for (const s of userSnaps) {
  const acct = byId.get(s.accountId);
  if (!acct) continue;
  const terminal = componentOf(s.accountId);
  // Only linked accounts collide inside a component. A bystander shares no
  // terminal with anyone else via the map (it is its own key) so a solo
  // bystander date is not a collision.
  if (!terminalOf.has(s.accountId) && !eff.some((l) => l.successorAccountId === s.accountId)) {
    continue;
  }
  const resolved = resolvedType(s.accountId, s.accountType);
  const key = `${terminal}|${s.date}`;
  const row: Candidate = {
    accountId: s.accountId,
    name: acct.name,
    date: s.date,
    balanceCents: s.balanceCents,
    recorded: s.accountType,
    resolved,
    liability: isLiabilityType(resolved),
    currentType: acct.type,
    won: kept.has(`${s.accountId}|${s.date}`),
  };
  const list = collisions.get(key) ?? [];
  list.push(row);
  collisions.set(key, list);
}

const colliding = [...collisions.entries()].filter(([, rows]) => rows.length > 1);
const classDisagree = colliding.filter(([, rows]) => new Set(rows.map((r) => r.liability)).size > 1);
const typeDisagreeSameClass = colliding.filter(([, rows]) => {
  const classes = new Set(rows.map((r) => r.liability));
  const types = new Set(rows.map((r) => r.resolved));
  return classes.size === 1 && types.size > 1;
});
const winnerVsLoser = classDisagree.filter(([, rows]) => {
  const winner = rows.find((r) => r.won);
  return winner !== undefined && rows.some((r) => !r.won && r.liability !== winner.liability);
});

const recordedVsCurrent = userSnaps.filter((s) => {
  const acct = byId.get(s.accountId);
  if (!acct) return false;
  if (s.accountType === null || s.accountType === '') return false;
  return isLiabilityType(s.accountType) !== isLiabilityType(acct.type);
});

console.log('='.repeat(78));
console.log("U.7 — DOES ANY COLLISION DISAGREE ON A DATE'S SIGN?");
console.log('='.repeat(78));
console.log(`live links:              ${userLinks.length}`);
console.log(`effective links:         ${eff.length}`);
console.log(`inert links:             ${inert.length}`);
const typeFill = { nullish: 0, filled: 0 };
const recordedTypes = new Map<string, number>();
for (const s of userSnaps) {
  if (s.accountType === null || s.accountType === '') typeFill.nullish += 1;
  else typeFill.filled += 1;
  const key = `${s.accountType ?? 'NULL'} / today=${byId.get(s.accountId)?.type ?? '?'}`;
  recordedTypes.set(key, (recordedTypes.get(key) ?? 0) + 1);
}
console.log(`snapshots:               ${userSnaps.length} (accountType filled ${typeFill.filled}, null/empty ${typeFill.nullish})`);
console.log(`colliding (comp, date):  ${colliding.length}`);
console.log(`class-disagree collide:  ${classDisagree.length}`);
console.log(`type-disagree same class:${typeDisagreeSameClass.length}`);
console.log(`winner vs loser class:   ${winnerVsLoser.length}`);
console.log(`recorded vs current class (any snapshot, not just collisions): ${recordedVsCurrent.length}`);
console.log('recorded / today type pairs:');
for (const [k, n] of [...recordedTypes.entries()].sort()) console.log(`  ${n}×  ${k}`);

if (inert.length > 0) {
  console.log('\nINERT LINKS (do not enter the boundary; both sides count fully)');
  for (const l of inert) {
    const pred = byId.get(l.predecessorAccountId);
    const succ = byId.get(l.successorAccountId);
    console.log(
      `  ${pred?.name ?? l.predecessorAccountId} [${pred?.type}]  →  ${succ?.name ?? l.successorAccountId} [${succ?.type}]`,
    );
  }
}

const printCollision = (label: string, items: typeof colliding) => {
  console.log(`\n${label} — ${items.length}`);
  for (const [key, rows] of items) {
    const terminal = byId.get(key.split('|')[0] ?? '');
    console.log(`  ${rows[0]?.date}  component="${terminal?.name ?? key}"`);
    for (const r of rows) {
      const rec = r.recorded === null || r.recorded === '' ? 'NULL→' + r.resolved : r.recorded;
      console.log(
        `      ${r.won ? '==> COUNTED ' : '    dropped '} ${money(r.balanceCents).padStart(14)}  ` +
          `${r.liability ? 'LIAB' : 'ASSET'} recorded=${rec} today=${r.currentType}  ${r.name}`,
      );
    }
    const winner = rows.find((r) => r.won);
    if (winner) {
      const alt = rows.find((r) => !r.won && r.liability !== winner.liability);
      if (alt) {
        const signed = (r: Candidate) => (r.liability ? -r.balanceCents : r.balanceCents);
        console.log(
          `      sign-if-winner ${money(signed(winner))}; sign-if-loser-won ${money(signed(alt))}; ` +
            `swing ${money(signed(winner) - signed(alt))}`,
        );
      }
    }
  }
};

if (classDisagree.length > 0) printCollision('CLASS-DISAGREE COLLISIONS (the U.7 shape)', classDisagree);
if (typeDisagreeSameClass.length > 0) {
  printCollision('TYPE-DISAGREE SAME CLASS (CREDIT vs LOAN — sign unchanged)', typeDisagreeSameClass);
}
if (classDisagree.length === 0 && colliding.length > 0) {
  console.log('\nNo colliding date disagrees on asset vs liability.');
  console.log('Sample of colliding dates (first 8):');
  for (const [key, rows] of colliding.slice(0, 8)) {
    const terminal = byId.get(key.split('|')[0] ?? '');
    const types = [...new Set(rows.map((r) => r.resolved))].join('/');
    console.log(
      `  ${rows[0]?.date}  ${rows.length} rows  types=${types}  component="${terminal?.name ?? '?'}"`,
    );
  }
}

if (recordedVsCurrent.length > 0) {
  console.log(`\nSNAPSHOTS WHOSE RECORDED CLASS ≠ ACCOUNT TODAY (${recordedVsCurrent.length}) — U.6, not U.7`);
  for (const s of recordedVsCurrent.slice(0, 20)) {
    const acct = byId.get(s.accountId);
    console.log(
      `  ${s.date}  recorded=${s.accountType} today=${acct?.type}  ${money(s.balanceCents)}  ${acct?.name}`,
    );
  }
}

console.log('\n' + '='.repeat(78));
await c.end();
