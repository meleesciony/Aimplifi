/**
 * U.11b — READ-ONLY: what ARE production's sibling fan-ins, and what money do they move?
 *
 * The U.11 census found 5 successors with more than one live predecessor — the shape
 * U.11 calls "one real account connected twice". Their transaction agreement inside the
 * overlap is 0% in every case, while every genuine one-account-two-feeds pair in the same
 * database agrees 98-100%. That is the opposite of what the task row assumed, so this
 * probe asks the follow-up directly: are these distinct real accounts wrongly paired, and
 * if so what is already being dropped from the owner's figures?
 *
 * Reports per sibling component: each account's mask/last4, type, currency, current
 * balance, the link's matchSignal + confidence + who confirmed it and when, its
 * BalanceSnapshot rows, and the net-worth exclusion the boundary applies today.
 *
 * Every statement is a SELECT. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u11b-sibling-pairing-truth.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const money = (cents: number | null) =>
  cents === null
    ? '(null)'
    : `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

const links = (
  await c.query(
    `SELECT id, "userId", "predecessorAccountId", "successorAccountId", "cutoverDate",
            "matchSignal", confidence, "confirmedByUserAt", "undoneAt"
       FROM "AccountReconciliation" WHERE "undoneAt" IS NULL`,
  )
).rows;

// successors carrying more than one live predecessor
const bySucc = new Map<string, typeof links>();
for (const l of links) {
  if (!bySucc.has(l.successorAccountId)) bySucc.set(l.successorAccountId, []);
  bySucc.get(l.successorAccountId)!.push(l);
}
const fanIns = [...bySucc.entries()].filter(([, ls]) => ls.length > 1);

console.log('='.repeat(78));
console.log('U.11b — SIBLING FAN-IN PAIRING TRUTH (production, read-only)');
console.log('='.repeat(78));
console.log(`live links ${links.length}; successors with >1 live predecessor: ${fanIns.length}`);

let excludedTotal = 0;
const rowsFor = async (ids: string[]) =>
  (
    await c.query(
      `SELECT id, name, type, subtype, mask, currency, "currentBalanceCents",
              "institutionName", "feedDroppedAt"
         FROM "Account" WHERE id = ANY($1::text[])`,
      [ids],
    )
  ).rows;

for (const [succId, ls] of fanIns) {
  const ids = [succId, ...ls.map((l) => l.predecessorAccountId)];
  const accts = await rowsFor(ids);
  const byId = new Map(accts.map((a) => [a.id, a]));
  const s = byId.get(succId);

  console.log('\n' + '-'.repeat(78));
  if (!s) {
    console.log(
      `SUCCESSOR  ${succId} — *** NO Account ROW EXISTS *** (dangling link; ${ls.length} predecessors point at it)`,
    );
    for (const l of ls) {
      const p = byId.get(l.predecessorAccountId);
      console.log(
        `  PRED     ${p?.name ?? `${l.predecessorAccountId} (also missing)`} ` +
          `balance=${money(p?.currentBalanceCents ?? null)} cutover=${l.cutoverDate} ` +
          `signal=${l.matchSignal} confidence=${l.confidence}`,
      );
    }
    continue;
  }
  console.log(
    `SUCCESSOR  ${s.name}\n           type=${s.type}/${s.subtype ?? '-'} mask=${s.mask ?? '-'} ` +
      `cur=${s.currency ?? '-'} balance=${money(s.currentBalanceCents)} inst=${s.institutionName ?? '-'}`,
  );
  console.log(`           ${ls.length} live predecessors:`);
  for (const l of ls) {
    const p = byId.get(l.predecessorAccountId);
    if (!p) {
      console.log(`  PRED     ${l.predecessorAccountId} — *** NO Account ROW EXISTS *** (dangling link)`);
      continue;
    }
    console.log(
      `  PRED     ${p.name}\n           type=${p.type}/${p.subtype ?? '-'} mask=${p.mask ?? '-'} ` +
        `cur=${p.currency ?? '-'} balance=${money(p.currentBalanceCents)} inst=${p.institutionName ?? '-'}` +
        `\n           link cutover=${l.cutoverDate} signal=${l.matchSignal} confidence=${l.confidence} ` +
        `confirmedAt=${l.confirmedByUserAt?.toISOString?.().slice(0, 19) ?? l.confirmedByUserAt}`,
    );
    excludedTotal += p.currentBalanceCents ?? 0;
  }

  // distinctness evidence: do the masks differ?
  const masks = accts.map((a) => a.mask).filter(Boolean);
  const distinctMasks = new Set(masks);
  console.log(
    `  MASKS    ${masks.length ? masks.join(', ') : '(none recorded)'} — ` +
      `${distinctMasks.size} distinct across ${accts.length} accounts` +
      (distinctMasks.size > 1
        ? '  ==> the paired rows carry DIFFERENT account numbers'
        : '  ==> masks agree or are absent'),
  );

  // snapshots: what does the component rule have to choose between?
  const snaps = (
    await c.query(
      `SELECT "accountId", date, "balanceCents", "accountType"
         FROM "BalanceSnapshot" WHERE "accountId" = ANY($1::text[]) ORDER BY date, "accountId"`,
      [ids],
    )
  ).rows;
  const byDate = new Map<string, typeof snaps>();
  for (const r of snaps) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }
  const collisions = [...byDate.entries()].filter(([, rs]) => rs.length > 1);
  console.log(
    `  SNAPSHOTS ${snaps.length} rows over ${byDate.size} dates; ` +
      `${collisions.length} dates hold more than one row (post-U.9 exactly ONE survives each)`,
  );
  for (const [date, rs] of collisions) {
    const total = rs.reduce((t, r) => t + r.balanceCents, 0);
    console.log(
      `      ${date}: ${rs.length} rows ${rs
        .map((r) => `${byId.get(r.accountId)?.name?.slice(0, 26) ?? r.accountId}=${money(r.balanceCents)}`)
        .join(' | ')}  (sum ${money(total)} — one is kept)`,
    );
  }
}

console.log('\n' + '='.repeat(78));
console.log(
  `Sum of CURRENT balances on every predecessor in a sibling fan-in: ${money(excludedTotal)}\n` +
    `(a superseded predecessor's balance is excluded from net worth by construction —\n` +
    ` schema AccountReconciliation.predecessorAccountId: "balance excluded")`,
);
console.log('='.repeat(78));

await c.end();
