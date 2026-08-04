/**
 * READ-ONLY production probe — C.6 (audit P0-1): is a mid-cycle card payment
 * really invisible, and what would crediting it change?
 *
 * Every statement is a SELECT. Nothing is written.
 *
 * The audit claims `CardPayment` has no production writer, so
 * `paymentsAppliedCents` is 0 forever on linked cards and a settled bill is
 * demanded again. Before building an intake, MEASURE it:
 *
 *   1. how many CardPayment rows exist for the linked user (audit says 0);
 *   2. per CREDIT account, the statement `assemble.ts` would call CURRENT
 *      (newest whose dueDate >= today OR whose balance is not fully paid);
 *   3. every POSTED positive-amount row on that card dated after the current
 *      statement's cycleEnd — the candidate payments — and for each, whether a
 *      PAIR exists (same |amount|, opposite sign, a DIFFERENT account of this
 *      user, within +/-3 days), which is the only proof that the money came
 *      from an account we can see rather than from a merchant refund;
 *   4. remainingDue today vs. remainingDue with the paired rows credited.
 *
 * Dates here are all `String` YYYY-MM-DD columns (Statement.cycleEnd,
 * Transaction.date), never DateTime — so L.27's driver-parsed-timestamp trap
 * does not apply. `today` still comes from the database as text.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { compareDates, daysBetween, isoDate } from '../../src/lib/dates';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const money = (v: number) =>
  `${v < 0 ? '-' : ''}$${Math.abs(v / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const users = await c.query<{ id: string; email: string; paymentAccountId: string | null }>(
  `select u.id, u.email, u."paymentAccountId" from "User" u
   where exists (select 1 from "Account" a where a."userId" = u.id and a."plaidItemId" is not null)
   order by u.id asc`,
);
if (users.rows.length === 0) throw new Error('no linked user found');
const user = users.rows[0];
console.log(`user ${user.id} <${user.email}>  paymentAccountId=${user.paymentAccountId ?? '(none)'}`);

const nowRow = await c.query<{ today: string }>(`select to_char(now(), 'YYYY-MM-DD') as today`);
const today = isoDate(nowRow.rows[0].today);
console.log(`today (db) = ${today}\n`);

type AccountRow = {
  id: string;
  name: string;
  displayName: string | null;
  type: string;
  provider: string;
  currentBalanceCents: string;
  feedDroppedAt: string | null;
  mask: string | null;
  currency: string | null;
};
const accounts = (
  await c.query<AccountRow>(
    `select id, name, "displayName", type, provider, "currentBalanceCents"::text,
            "feedDroppedAt", mask, currency
     from "Account" where "userId" = $1 order by type, name`,
    [user.id],
  )
).rows;

console.log('══ 1. CardPayment rows for this user ══');
const cps = (
  await c.query<{ id: string; statementId: string; date: string; amountCents: string; source: string }>(
    `select cp.id, cp."statementId", cp.date, cp."amountCents"::text, cp.source
     from "CardPayment" cp
     join "Statement" s on s.id = cp."statementId"
     join "Account" a on a.id = s."accountId"
     where a."userId" = $1 order by cp.date`,
    [user.id],
  )
).rows;
console.log(`  ${cps.length} row(s)`);
for (const p of cps) console.log(`    ${p.date}  ${money(Number(p.amountCents))}  source=${p.source}  stmt=${p.statementId}`);
const allCp = await c.query<{ n: string }>(`select count(*)::text as n from "CardPayment"`);
console.log(`  (whole database, every user: ${allCp.rows[0].n} row(s))\n`);

type TxnRow = {
  id: string;
  accountId: string;
  date: string;
  amountCents: string;
  rawDescriptor: string;
  isTransfer: boolean;
  isSplitParent: boolean;
  status: string;
};
const txns = (
  await c.query<TxnRow>(
    `select t.id, t."accountId", t.date, t."amountCents"::text, t."rawDescriptor",
            t."isTransfer", t."isSplitParent", t.status
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where a."userId" = $1 and (a.currency is null or a.currency = 'USD')
     order by t.date`,
    [user.id],
  )
).rows;
console.log(`(${txns.length} USD transactions loaded)\n`);

/** The pair proof: a same-|amount| opposite-sign POSTED row on a DIFFERENT
 *  account of this user within +/-3 days. */
function pairFor(t: TxnRow): TxnRow | null {
  const amt = Math.abs(Number(t.amountCents));
  for (const o of txns) {
    if (o.id === t.id) continue;
    if (o.accountId === t.accountId) continue;
    if (o.status !== 'POSTED') continue;
    if (Math.abs(Number(o.amountCents)) !== amt) continue;
    if (Math.sign(Number(o.amountCents)) === Math.sign(Number(t.amountCents))) continue;
    if (Math.abs(daysBetween(isoDate(o.date), isoDate(t.date))) <= 3) return o;
  }
  return null;
}

type StmtRow = {
  id: string;
  accountId: string;
  cycleStart: string;
  cycleEnd: string;
  dueDate: string;
  statementBalanceCents: string;
  minimumPaymentCents: string;
  isEstimated: boolean;
};
const statements = (
  await c.query<StmtRow>(
    `select s.id, s."accountId", s."cycleStart", s."cycleEnd", s."dueDate",
            s."statementBalanceCents"::text, s."minimumPaymentCents"::text, s."isEstimated"
     from "Statement" s join "Account" a on a.id = s."accountId"
     where a."userId" = $1 order by s."cycleEnd" desc`,
    [user.id],
  )
).rows;

console.log('══ 2-4. Per CREDIT account ══');
const cards = accounts.filter((a) => a.type === 'CREDIT');
if (cards.length === 0) console.log('  (no CREDIT accounts)');
let totalToday = 0;
let totalFixed = 0;
for (const card of cards) {
  const label = card.displayName ?? card.name;
  const own = statements
    .filter((s) => s.accountId === card.id)
    .sort((a, b) => compareDates(isoDate(b.cycleEnd), isoDate(a.cycleEnd)));
  const paidAgainst = (id: string) =>
    cps.filter((p) => p.statementId === id).reduce((n, p) => n + Number(p.amountCents), 0);
  const current =
    own.find(
      (s) =>
        compareDates(isoDate(s.dueDate), today) >= 0 ||
        Number(s.statementBalanceCents) - paidAgainst(s.id) > 0,
    ) ?? null;

  console.log(
    `\n  ── ${label} (${card.mask ?? '----'})  provider=${card.provider}  balance=${money(Number(card.currentBalanceCents))}  frozen=${card.feedDroppedAt ?? 'no'}`,
  );
  console.log(`     ${own.length} statement(s) on file`);
  if (!current) {
    console.log('     current statement: NONE (estimate path) — no cycleEnd to date payments against');
    continue;
  }
  console.log(
    `     current: cycleEnd=${current.cycleEnd} due=${current.dueDate} balance=${money(Number(current.statementBalanceCents))} estimated=${current.isEstimated}`,
  );

  const candidates = txns.filter(
    (t) =>
      t.accountId === card.id &&
      t.status === 'POSTED' &&
      !t.isSplitParent &&
      Number(t.amountCents) > 0 &&
      compareDates(isoDate(t.date), isoDate(current.cycleEnd)) > 0,
  );
  console.log(`     post-close credits (POSTED, amount > 0, date > cycleEnd): ${candidates.length}`);
  let credited = 0;
  for (const t of candidates) {
    const p = pairFor(t);
    const acct = p ? accounts.find((a) => a.id === p.accountId) : null;
    if (p) credited += Number(t.amountCents);
    console.log(
      `       ${t.date}  ${money(Number(t.amountCents))}  isTransfer=${t.isTransfer}  "${t.rawDescriptor.slice(0, 40)}"` +
        (p
          ? `  ⇒ PAIRED with ${p.date} ${money(Number(p.amountCents))} on ${acct?.displayName ?? acct?.name ?? p.accountId} (${acct?.type})`
          : '  ⇒ no pair (refund, or paid from an account we cannot see)'),
    );
  }
  const bal = Number(current.statementBalanceCents);
  const dueToday = Math.max(0, bal - paidAgainst(current.id));
  const dueFixed = Math.max(0, bal - paidAgainst(current.id) - credited);
  totalToday += dueToday;
  totalFixed += dueFixed;
  console.log(
    `     remainingDue today = ${money(dueToday)}   with paired credits = ${money(dueFixed)}   delta = ${money(dueFixed - dueToday)}`,
  );
}

// ── 5. Does the pair proof EVER fire on this data? ────────────────────────────
// A $0.00 delta today is not evidence the rule is dead: the owner's statements
// all closed 2026-07-11 and are due 2026-08-05, so a payment made in this window
// is exactly what has not happened YET. Scan the whole history instead.
console.log('\n══ 5. Every POSTED inflow on a CREDIT account, across all history ══');
const cardIds = new Set(cards.map((a) => a.id));
const allCardInflows = txns.filter(
  (t) => cardIds.has(t.accountId) && t.status === 'POSTED' && !t.isSplitParent && Number(t.amountCents) > 0,
);
// A/B the counterpart constraint. The NAIVE rule (any own account) is what the
// audit's fix direction implies; the STRICT rule requires the counterpart to sit
// on an account that can actually pay a card (CHECKING/SAVINGS). The owner holds
// DUPLICATE connections (the same card under both SimpleFIN and Plaid), so a
// merchant refund appears on two card rows +/-1 day apart and pairs with itself.
const PAYS_CARDS = new Set(['CHECKING', 'SAVINGS']);
let naive = 0;
let naiveCents = 0;
let strict = 0;
let strictCents = 0;
const falsePositives: string[] = [];
for (const t of allCardInflows) {
  const p = pairFor(t);
  if (!p) continue;
  const acct = accounts.find((a) => a.id === p.accountId);
  const card = accounts.find((a) => a.id === t.accountId);
  const ok = acct ? PAYS_CARDS.has(acct.type) : false;
  naive += 1;
  naiveCents += Number(t.amountCents);
  if (ok) {
    strict += 1;
    strictCents += Number(t.amountCents);
  } else {
    falsePositives.push(
      `    ${t.date}  ${money(Number(t.amountCents))}  on ${card?.displayName ?? card?.name}  "${t.rawDescriptor.slice(0, 34)}"  ⇐ ${acct?.type} ${acct?.displayName ?? acct?.name}`,
    );
  }
}
console.log(
  `  ${allCardInflows.length} card inflow(s): NAIVE pair (any own account) matches ${naive} (${money(naiveCents)});` +
    ` STRICT pair (counterpart on CHECKING/SAVINGS) matches ${strict} (${money(strictCents)}).`,
);
console.log(`\n  The ${falsePositives.length} row(s) the NAIVE rule would credit and the STRICT rule refuses:`);
for (const l of falsePositives) console.log(l);

console.log(`\n══ TOTAL across cards ══`);
console.log(`  demanded today: ${money(totalToday)}`);
console.log(`  with paired post-close credits applied: ${money(totalFixed)}`);
console.log(`  over-demand attributable to P0-1: ${money(totalToday - totalFixed)}`);

await c.end();
