/**
 * U.13a — READ-ONLY: is the silent loss a BOUNDARY-DAY defect or a span-wide one?
 *
 * U.13's task row prescribes a fix ("drop a row only when a counterpart is PROVEN
 * on the claiming side — exact |amount| with a +/-3-day tolerance"). Per
 * docs/lessons/measure-the-prescribed-fix-not-just-the-bug.md, a row's prescribed
 * remedy is a hypothesis: this probe measures the state the fix would PRODUCE, and
 * measures the cheaper alternative beside it, before any code moves.
 *
 * u11c established the loss with an EXACT (date, amount) survivor test and found 3
 * uncovered rows. Two of those (PGA TOUR SUPERSTORE, DICK'S) are suspected to be
 * true duplicates posted a day apart by the two feeds -- an artifact of the exact-date
 * test, not a loss. This probe replaces that test with the one the fix would actually
 * use, and asks the question that picks the design:
 *
 *   For every row the SHIPPED rule drops, does the CLAIMING side (the upstream
 *   predecessor whose span covers it) actually hold a counterpart -- same |amount|,
 *   within a tolerance -- matched ONE-TO-ONE so that a single predecessor row cannot
 *   excuse two successor rows?
 *
 * and then, for each row with no counterpart, WHERE does it sit:
 *
 *   BOUNDARY  = on the last day of the claiming predecessor's span (the day the old
 *               feed stopped mid-day and the new one kept going)
 *   MID-SPAN  = anywhere earlier (the old feed was live all day and simply never
 *               reported this row)
 *
 * If every true loss is BOUNDARY, the mechanism is the boundary day and the remedy can
 * be a span change -- no signature change, no caller change. If losses are MID-SPAN
 * too, the amount-counterpart rule is required and every caller must be handed the
 * claiming side's rows.
 *
 * It also measures the COST of the boundary-day remedy: how many dropped rows sit on a
 * boundary day and DO have a counterpart (those become visible doubles if the boundary
 * day is released wholesale).
 *
 * Every statement is a SELECT. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u13a-where-the-loss-lives.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  reconciliationTxnKeepFilter,
  effectiveReconciliationLinks,
} from '../../src/lib/engine/account/reconcile-boundary';

const TOLERANCE_DAYS = [0, 1, 3, 7];

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

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

interface Acct {
  id: string;
  userId: string;
  name: string;
  type: string;
  currency: string | null;
  currentBalanceCents: number;
}
interface Txn {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
}

const accounts: Acct[] = (
  await c.query(`SELECT id, "userId", name, type, currency, "currentBalanceCents" FROM "Account"`)
).rows;
const links = (
  await c.query(
    `SELECT id, "userId", "predecessorAccountId", "successorAccountId", "cutoverDate",
            "matchSignal", confidence, "undoneAt"
       FROM "AccountReconciliation" WHERE "undoneAt" IS NULL`,
  )
).rows;

const byUser = new Map<string, Acct[]>();
for (const a of accounts) {
  if (!byUser.has(a.userId)) byUser.set(a.userId, []);
  byUser.get(a.userId)!.push(a);
}

console.log('='.repeat(78));
console.log('U.13a — WHERE DOES THE SILENT LOSS ACTUALLY LIVE? (production, read-only)');
console.log('='.repeat(78));

interface LossRow {
  txn: Txn;
  acctName: string;
  position: 'BOUNDARY' | 'MID-SPAN';
  claimEnd: string;
}

for (const [userId, userAccounts] of byUser) {
  const userLinks = links.filter((l) => l.userId === userId);
  if (!userLinks.length) continue;

  const eff = effectiveReconciliationLinks(userAccounts, userLinks);
  if (!eff.length) continue;

  const linkedIds = new Set<string>();
  for (const l of eff) {
    linkedIds.add(l.predecessorAccountId);
    linkedIds.add(l.successorAccountId);
  }

  const spanRows = (
    await c.query(
      `SELECT "accountId", MIN(date) AS first, MAX(date) AS last
         FROM "Transaction"
        WHERE "accountId" = ANY($1::text[]) AND "isSplitParent" = false
        GROUP BY "accountId"`,
      [[...new Set(eff.map((l) => l.predecessorAccountId))]],
    )
  ).rows as { accountId: string; first: string; last: string }[];

  const keep = reconciliationTxnKeepFilter(userAccounts, userLinks, spanRows);

  const txns: Txn[] = (
    await c.query(
      `SELECT id, "accountId", date, "amountCents", "rawDescriptor"
         FROM "Transaction"
        WHERE "accountId" = ANY($1::text[]) AND "isSplitParent" = false
        ORDER BY date, id`,
      [[...linkedIds]],
    )
  ).rows;

  const dropped = txns.filter((t) => !keep(t.accountId, t.date));
  if (!dropped.length) continue;

  // Upstream walk over EFFECTIVE links: who can claim a row on this account?
  const predsOf = new Map<string, string[]>();
  for (const l of eff) {
    const arr = predsOf.get(l.successorAccountId) ?? [];
    arr.push(l.predecessorAccountId);
    predsOf.set(l.successorAccountId, arr);
  }
  const upstreamsOf = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    const stack = [...(predsOf.get(id) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      for (const p of predsOf.get(cur) ?? []) stack.push(p);
    }
    return out;
  };

  const cutoverOf = new Map(eff.map((l) => [l.predecessorAccountId, String(l.cutoverDate).slice(0, 10)]));
  const spanOf = new Map(spanRows.map((s) => [s.accountId, s]));
  // The claim span the shipped rule uses: [first, min(cutover, last)]
  const claimEndOf = (predId: string): string | null => {
    const s = spanOf.get(predId);
    const cut = cutoverOf.get(predId);
    if (!s || !cut) return null;
    const first = String(s.first).slice(0, 10);
    const last = String(s.last).slice(0, 10);
    const end = last < cut ? last : cut;
    return end < first ? null : end;
  };

  const rowsByAcct = new Map<string, Txn[]>();
  for (const t of txns) {
    if (!rowsByAcct.has(t.accountId)) rowsByAcct.set(t.accountId, []);
    rowsByAcct.get(t.accountId)!.push(t);
  }
  const acctName = new Map(userAccounts.map((a) => [a.id, a.name]));

  console.log(`\nuser ${userId}: ${eff.length} effective links, ${txns.length} rows, ${dropped.length} dropped by the shipped rule`);

  for (const tol of TOLERANCE_DAYS) {
    // One-to-one matching: each claiming-side row can excuse at most ONE dropped row.
    const consumed = new Set<string>();
    const losses: LossRow[] = [];
    let boundaryCovered = 0;

    for (const t of dropped) {
      const claimers = upstreamsOf(t.accountId).filter((p) => {
        const end = claimEndOf(p);
        const s = spanOf.get(p);
        if (!end || !s) return false;
        return t.date >= String(s.first).slice(0, 10) && t.date <= end;
      });
      if (!claimers.length) continue; // dropped for another reason; not this rule's row

      let match: Txn | null = null;
      for (const p of claimers) {
        for (const cand of rowsByAcct.get(p) ?? []) {
          if (consumed.has(cand.id)) continue;
          if (Math.abs(cand.amountCents) !== Math.abs(t.amountCents)) continue;
          if (Math.abs(dayDiff(cand.date, t.date)) > tol) continue;
          match = cand;
          break;
        }
        if (match) break;
      }

      const ends = claimers.map((p) => claimEndOf(p)!).filter(Boolean).sort();
      const onBoundary = ends.some((e) => e === t.date);

      if (match) {
        consumed.add(match.id);
        if (onBoundary) boundaryCovered++;
      } else {
        losses.push({
          txn: t,
          acctName: acctName.get(t.accountId) ?? t.accountId,
          position: onBoundary ? 'BOUNDARY' : 'MID-SPAN',
          claimEnd: ends[ends.length - 1] ?? '?',
        });
      }
    }

    const lossCents = losses.reduce((s, l) => s + Math.abs(l.txn.amountCents), 0);
    const nBoundary = losses.filter((l) => l.position === 'BOUNDARY').length;
    const nMid = losses.filter((l) => l.position === 'MID-SPAN').length;

    console.log(
      `\n  --- counterpart tolerance +/-${tol}d --- ` +
        `unmatched (true silent loss): ${losses.length} rows / ${money(lossCents)}  ` +
        `[BOUNDARY ${nBoundary} | MID-SPAN ${nMid}]`,
    );
    if (tol === 3) {
      console.log(
        `      cost of releasing the boundary day wholesale: ${boundaryCovered} dropped rows ` +
          `sit on a boundary day AND have a counterpart -> they would become VISIBLE DOUBLES`,
      );
    }
    for (const l of losses) {
      console.log(
        `      ${l.position.padEnd(8)} ${l.txn.date} ${money(l.txn.amountCents).padStart(12)}  ` +
          `${l.acctName} — ${l.txn.rawDescriptor.slice(0, 44)} (claim ends ${l.claimEnd})`,
      );
    }
  }
}

console.log('\n' + '='.repeat(78));
console.log('read-only, nothing written.');
console.log('='.repeat(78));

await c.end();
