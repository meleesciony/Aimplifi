/**
 * O.11c — the reimbursement round trip, SIZED on the live corpus.
 *
 * READ-ONLY: every statement is a SELECT; nothing is written. (Idiom: the
 * sibling audit probes — `pg` against `.env.prod.tmp`, one console block per
 * user.)
 *
 * The question the fix answers: how much money were the reports chart, the
 * /coach savings rate, the Ask income answers and the spending-plan fallback
 * booking as INCOME that was the return of the reader's own money — a positive
 * row filed to the `reimbursement` leaf? Before this slice, #166 paid every
 * Income-group leaf except `refund` as income, while the O.15 tracker's own
 * premise is that this money is a reimbursable outflow COMING BACK.
 *
 * For each user: the rows `isReimbursementInflow` now skips (they were each
 * the whole income story of a bar), the month-by-month income delta
 * old→new, the savings-rate bps delta for the affected months, and the two
 * companion populations that make the treatment legible:
 *   - excluded outflows (the `excludeFromTotals` lever the owner pulls when
 *     marking an expense reimbursable — his exact use case), and
 *   - rows carrying the tracker's own `reimbursement` flag.
 *
 * The engine's own predicates compute both sides — the NEW figures come from
 * `monthlyFlows` running the shipped code; the OLD income is reconstructed by
 * adding back exactly the skipped rows, which is what the old predicate did
 * (it admitted every Income-group leaf but `refund`).
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  countsInFlows,
  isReimbursementInflow,
  monthlyFlows,
  type TxnLike,
} from '../../src/lib/engine/fi/insights';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

interface Row {
  userId: string;
  email: string;
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  isTransfer: boolean;
  status: string;
  isSplitParent: boolean;
  categoryId: string | null;
  excludeFromTotals: boolean;
  reimbursement: string | null;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const users = await c.query<Row>(
  `select u.id as "userId", u.email, t.id, t."accountId", t.date::text as date,
          t."amountCents", t."rawDescriptor", t."isTransfer", t.status,
          t."isSplitParent", t."categoryId", t."excludeFromTotals", t.reimbursement
     from "Transaction" t
     join "Account" a on a.id = t."accountId"
     join "User" u on u.id = a."userId"
    order by u.id, t.date`,
);

const byUser = new Map<string, Row[]>();
for (const r of users.rows) {
  const arr = byUser.get(r.userId) ?? [];
  arr.push(r);
  byUser.set(r.userId, arr);
}

let anyUser = false;
for (const [userId, rows] of byUser) {
  const txns: TxnLike[] = rows.map((r) => ({
    id: r.id,
    date: r.date.slice(0, 10),
    amountCents: r.amountCents,
    rawDescriptor: r.rawDescriptor,
    accountId: r.accountId,
    isTransfer: r.isTransfer,
    status: r.status,
    isSplitParent: r.isSplitParent,
    categoryId: r.categoryId,
    excludeFromTotals: r.excludeFromTotals,
  }));
  const affected = txns.filter((t) => countsInFlows(t) && isReimbursementInflow(t));
  const excludedOutflows = txns.filter((t) => t.excludeFromTotals === true && t.amountCents < 0);
  const trackerFlagged = rows.filter((r) => r.reimbursement != null).length;
  if (affected.length === 0 && excludedOutflows.length === 0 && trackerFlagged === 0) continue;
  anyUser = true;
  const affectedTotal = affected.reduce((n, t) => n + t.amountCents, 0);
  console.log(
    `===== user ${userId} <${rows[0].email}>: ${affected.length} reimbursement inflow(s) ` +
      `${usd(affectedTotal)} | ${excludedOutflows.length} excluded outflow(s) | ` +
      `${trackerFlagged} tracker-flagged row(s) =====`,
  );
  if (affected.length > 0) {
    const newFlows = monthlyFlows(txns);
    const byMonthOld = new Map<string, number>();
    for (const t of affected) {
      const m = t.date.slice(0, 7);
      byMonthOld.set(m, (byMonthOld.get(m) ?? 0) + t.amountCents);
    }
    for (const [m, oldDelta] of byMonthOld) {
      const f = newFlows.find((x) => x.month === m);
      const newIncome = f?.incomeCents ?? 0;
      const oldIncome = newIncome + oldDelta;
      const exp = f?.expensesCents ?? 0;
      const oldBps = oldIncome > 0 ? Math.round(((oldIncome - exp) / oldIncome) * 10000) : null;
      const newBps = f?.savingsRateBps ?? null;
      console.log(
        `  ${m}: income ${usd(oldIncome)} (old) -> ${usd(newIncome)} (new), ` +
          `phantom removed ${usd(oldDelta)}; savings rate ${oldBps ?? 'n/a'} bps -> ` +
          `${newBps ?? 'n/a'} bps`,
      );
      for (const t of affected.filter((x) => x.date.slice(0, 7) === m)) {
        console.log(
          `    row ${t.id} ${t.date} ${usd(t.amountCents)} "${t.rawDescriptor.slice(0, 40)}"`,
        );
      }
    }
  }
}
if (!anyUser) console.log('no reimbursement-categorized inflows, excluded outflows, or tracker-flagged rows corpus-wide');

await c.end();
