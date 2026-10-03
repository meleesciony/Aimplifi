/** READ-ONLY (owner-authorized 2026-10-03): every reconciliation link for the 0977 owner. */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();
// Owner-scoped: abort unless exactly one user owns a 0977 row (critic P2-6) — never print a
// second user's accounts under the owner's authorization.
const owners0977 = (await c.query(`select distinct "userId" from "Account" where mask = '0977'`)).rows;
if (owners0977.length !== 1) { console.error(`expected exactly one 0977 owner, found ${owners0977.length} — aborting`); await c.end(); process.exit(1); }
const ownerId: string = owners0977[0].userId;
const short = (s: string | null) => (s ? s.slice(-6) : null);
const r = await c.query(
  `select r."cutoverDate", r."matchSignal", r."undoneAt", r."confirmedByUserAt",
          p.id as pid, p.provider as pprov, p.name as pname, p.mask as pmask,
          s.id as sid, s.provider as sprov, s.name as sname, s.mask as smask
     from "AccountReconciliation" r
     join "Account" p on p.id = r."predecessorAccountId"
     join "Account" s on s.id = r."successorAccountId"
    where r."userId" = $1
    order by r."confirmedByUserAt"`,
  [ownerId],
);
console.table(r.rows.map((x) => ({ cut: x.cutoverDate, sig: x.matchSignal, undone: x.undoneAt, at: x.confirmedByUserAt?.toISOString().slice(0, 10),
  pred: `${short(x.pid)} ${x.pprov} ${x.pname.slice(0, 40)} ${x.pmask ?? ''}`, succ: `${short(x.sid)} ${x.sprov} ${x.sname.slice(0, 30)} ${x.smask ?? ''}` })));
console.log('n=', r.rows.length);
await c.end();
