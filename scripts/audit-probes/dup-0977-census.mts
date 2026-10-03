/** READ-ONLY (owner-authorized 2026-10-03): why is the owner's ····0977 counted twice?
 * For the user who owns a 0977 row, prints every account whose last-4 is
 * shared with another of that user's rows, with its connection, sync health,
 * transaction span, and any reconciliation link that touches it. Never prints
 * the connection string. */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const short = (s: string | null) => (s ? s.slice(-6) : null);

const owners = await c.query<{ userId: string }>(
  `select distinct "userId" from "Account" where mask = '0977'`,
);
console.log('owners of a 0977 row:', owners.rows.length);
// Owner-scoped (critic P2-6): never walk a second user's accounts.
if (owners.rows.length !== 1) { console.error('expected exactly one 0977 owner — aborting'); await c.end(); process.exit(1); }

for (const { userId } of owners.rows) {
  const accts = await c.query(
    `select a.id, a.provider, a.name, a."displayName", a.type, a.subtype, a.mask,
            a."plaidItemId", a."institutionId" as acct_ins, a."institutionName" as acct_inst_name,
            a."persistentAccountId" is not null as has_persistent,
            a."currentBalanceCents", a."feedDroppedAt",
            i."institutionId" as item_ins, i.institution as item_inst,
            i."lastSyncedAt", i."lastSyncError",
            (select count(*)::int from "Transaction" t where t."accountId" = a.id) as n_txn,
            (select min(t.date) from "Transaction" t where t."accountId" = a.id) as first_txn,
            (select max(t.date) from "Transaction" t where t."accountId" = a.id) as last_txn
       from "Account" a
       left join "PlaidItem" i on i."itemId" = a."plaidItemId"
      where a."userId" = $1
        and a.mask in (select mask from "Account" where "userId" = $1 and mask is not null
                        group by mask having count(*) > 1)
      order by a.mask, a.type, a.provider, a.id`,
    [userId],
  );
  console.log(`\n=== user …${short(userId)}: accounts sharing a last-4 (${accts.rows.length}) ===`);
  console.table(
    accts.rows.map((r) => ({
      id: short(r.id),
      prov: r.provider,
      name: r.name,
      disp: r.displayName,
      type: r.type,
      sub: r.subtype,
      mask: r.mask,
      item: short(r.plaidItemId),
      item_ins: r.item_ins,
      acct_ins: r.acct_ins,
      inst: r.item_inst ?? r.acct_inst_name,
      persist: r.has_persistent,
      bal: r.currentBalanceCents,
      dropped: r.feedDroppedAt,
      synced: r.lastSyncedAt,
      err: r.lastSyncError,
      n_txn: r.n_txn,
      first: r.first_txn,
      last: r.last_txn,
    })),
  );

  const ids = accts.rows.map((r) => r.id);
  const recs = await c.query(
    `select id, "predecessorAccountId" as pred, "successorAccountId" as succ, "cutoverDate",
            "matchSignal", confidence, "confirmedByUserAt", "undoneAt"
       from "AccountReconciliation"
      where "userId" = $1 and ("predecessorAccountId" = any($2) or "successorAccountId" = any($2))`,
    [userId, ids],
  );
  console.log('reconciliation links touching those rows:');
  console.table(recs.rows.map((r) => ({ ...r, id: short(r.id), pred: short(r.pred), succ: short(r.succ) })));

  const items = await c.query(
    `select "itemId", institution, "institutionId", "lastSyncedAt", "lastSyncError", "createdAt",
            (select count(*)::int from "Account" a where a."plaidItemId" = p."itemId") as n_accts
       from "PlaidItem" p where "userId" = $1 order by "createdAt"`,
    [userId],
  );
  console.log('all Plaid connections for this user:');
  console.table(items.rows.map((r) => ({ ...r, itemId: short(r.itemId) })));

  const all = await c.query(
    `select id, provider, name, type, mask, "plaidItemId", "currentBalanceCents", "feedDroppedAt"
       from "Account" where "userId" = $1 order by "plaidItemId" nulls last, name`,
    [userId],
  );
  console.log('every account for this user:');
  console.table(all.rows.map((r) => ({ ...r, id: short(r.id), plaidItemId: short(r.plaidItemId) })));
}

await c.end();
