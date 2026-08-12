/**
 * U.13b — READ-ONLY: what is actually ON the boundary day, on BOTH sides?
 *
 * U.13a proved every true silent loss in this corpus sits on the LAST CLAIMED DAY of
 * a predecessor (claimEnd = min(cutover, last)) -- mid-span losses are zero once a
 * +/-1d posting difference is allowed. So the remedy is a claim-SPAN change, not the
 * counterpart rule the task row prescribed (which is not even expressible: the shipped
 * filter is an (accountId, date) predicate with ~20 call sites, several of them
 * applying it to WINDOWED row sets that do not hold the claiming side's rows).
 *
 * Three candidate span rules, and this probe measures what each PRODUCES:
 *
 *   SHIPPED  predecessor claims through claimEnd  -> successor rows that day are dropped
 *            (loses succ-only rows: the measured defect)
 *   RELEASE  nobody claims the boundary day       -> both sides keep their rows that day
 *            (never a silent loss; costs one visible DOUBLE per matched pair)
 *   AWARD    the successor owns the boundary day  -> predecessor drops its rows that day
 *            (no doubles; but LOSES any row only the predecessor reported that day)
 *
 * AWARD is only safe if pred-only rows on a boundary day are impossible, not merely
 * absent here. This probe counts them. It also reports whether the successor has any
 * coverage at all on that day, since awarding a day to a feed that reported nothing
 * would delete the predecessor's whole day.
 *
 * Matching is one-to-one on |amount| within +/-1 day (U.13a showed the match set is
 * identical from +/-1d through +/-7d, so the tolerance is not load-bearing).
 *
 * Every statement is a SELECT. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u13b-the-boundary-day-itself.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { effectiveReconciliationLinks } from '../../src/lib/engine/account/reconcile-boundary';

const TOL = 1;

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
console.log('U.13b — THE BOUNDARY DAY, BOTH SIDES (production, read-only)');
console.log('='.repeat(78));

let totMatched = 0;
let totMatchedCents = 0;
let totSuccOnly = 0;
let totSuccOnlyCents = 0;
let totPredOnly = 0;
let totPredOnlyCents = 0;
let totNoSuccCoverage = 0;

for (const [userId, userAccounts] of byUser) {
  const userLinks = links.filter((l) => l.userId === userId);
  if (!userLinks.length) continue;
  const eff = effectiveReconciliationLinks(userAccounts, userLinks);
  if (!eff.length) continue;

  const ids = new Set<string>();
  for (const l of eff) {
    ids.add(l.predecessorAccountId);
    ids.add(l.successorAccountId);
  }
  const txns: Txn[] = (
    await c.query(
      `SELECT id, "accountId", date, "amountCents", "rawDescriptor"
         FROM "Transaction"
        WHERE "accountId" = ANY($1::text[]) AND "isSplitParent" = false
        ORDER BY date, id`,
      [[...ids]],
    )
  ).rows;

  const rowsByAcct = new Map<string, Txn[]>();
  for (const t of txns) {
    const d = String(t.date).slice(0, 10);
    t.date = d;
    if (!rowsByAcct.has(t.accountId)) rowsByAcct.set(t.accountId, []);
    rowsByAcct.get(t.accountId)!.push(t);
  }
  const acctName = new Map(userAccounts.map((a) => [a.id, a.name]));

  console.log(`\nuser ${userId}: ${eff.length} effective links`);

  for (const l of eff) {
    const predRows = rowsByAcct.get(l.predecessorAccountId) ?? [];
    if (!predRows.length) continue;
    const succRows = rowsByAcct.get(l.successorAccountId) ?? [];
    const cut = String(l.cutoverDate).slice(0, 10);
    const first = predRows[0].date;
    const last = predRows[predRows.length - 1].date;
    const claimEnd = last < cut ? last : cut;
    if (claimEnd < first) continue; // degenerate claim (A-F8): no boundary day

    const predDay = predRows.filter((t) => t.date === claimEnd);
    const succDay = succRows.filter((t) => t.date === claimEnd);
    if (!predDay.length && !succDay.length) continue;

    // one-to-one match on |amount| within +/-TOL days, pred rows vs succ rows
    const usedPred = new Set<string>();
    const matched: Txn[] = [];
    const succOnly: Txn[] = [];
    for (const s of succDay) {
      const m = predRows.find(
        (p) =>
          !usedPred.has(p.id) &&
          Math.abs(p.amountCents) === Math.abs(s.amountCents) &&
          Math.abs(dayDiff(p.date, s.date)) <= TOL,
      );
      if (m) {
        usedPred.add(m.id);
        matched.push(s);
      } else succOnly.push(s);
    }
    const predOnly = predDay.filter((p) => !usedPred.has(p.id));

    const succHasCoverage = succRows.some((t) => t.date === claimEnd);
    // Did the predecessor keep reporting PAST its claim end? If so the feed was
    // demonstrably alive all through that day, so its coverage of it is complete
    // and there is nothing to release. If its claim end IS its last reported day,
    // the feed stopped inside that day and its coverage may be partial.
    const feedStoppedHere = !(last > claimEnd);
    if (matched.length)
      console.log(
        `        [refinement] pred last=${last} claimEnd=${claimEnd} -> ` +
          `${feedStoppedHere ? 'FEED STOPPED (release needed)' : 'FEED ALIVE PAST IT (no release needed)'}` +
          ` — ${matched.length} matched pair(s) at stake`,
      );
    const flag =
      predOnly.length > 0 ? '  <== AWARD would LOSE these' : succOnly.length > 0 ? '  <== SHIPPED loses these' : '';

    console.log(
      `  ${acctName.get(l.predecessorAccountId)?.slice(0, 28).padEnd(28)} -> ` +
        `${acctName.get(l.successorAccountId)?.slice(0, 22).padEnd(22)} ` +
        `claimEnd ${claimEnd}  pred ${String(predDay.length).padStart(2)} | succ ${String(succDay.length).padStart(2)} | ` +
        `matched ${String(matched.length).padStart(2)} | succ-only ${succOnly.length} | pred-only ${predOnly.length}` +
        `${succHasCoverage ? '' : ' | succ SILENT that day'}${flag}`,
    );
    for (const t of succOnly)
      console.log(`        succ-only ${t.date} ${money(t.amountCents).padStart(12)}  ${t.rawDescriptor.slice(0, 44)}`);
    for (const t of predOnly)
      console.log(`        pred-only ${t.date} ${money(t.amountCents).padStart(12)}  ${t.rawDescriptor.slice(0, 44)}`);

    totMatched += matched.length;
    totMatchedCents += matched.reduce((s, t) => s + Math.abs(t.amountCents), 0);
    for (const t of matched)
      console.log(`        matched   ${t.date} ${money(t.amountCents).padStart(12)}  ${t.rawDescriptor.slice(0, 44)}`);
    totSuccOnly += succOnly.length;
    totSuccOnlyCents += succOnly.reduce((s, t) => s + Math.abs(t.amountCents), 0);
    totPredOnly += predOnly.length;
    totPredOnlyCents += predOnly.reduce((s, t) => s + Math.abs(t.amountCents), 0);
    if (!succHasCoverage && predDay.length) totNoSuccCoverage++;
  }
}

console.log('\n' + '='.repeat(78));
console.log('WHAT EACH CANDIDATE RULE PRODUCES, ACROSS EVERY BOUNDARY DAY IN THE CORPUS');
console.log(
  `  matched pairs on boundary days (both feeds reported it): ${totMatched} / ${money(totMatchedCents)}\n` +
    `    SHIPPED counts these once (pred wins). RELEASE counts them TWICE (${totMatched} visible doubles).\n` +
    `    AWARD counts them once (succ wins).`,
);
console.log(
  `  succ-only rows on boundary days: ${totSuccOnly} / ${money(totSuccOnlyCents)}\n` +
    `    SHIPPED SILENTLY LOSES these. RELEASE and AWARD both keep them.`,
);
console.log(
  `  pred-only rows on boundary days: ${totPredOnly} / ${money(totPredOnlyCents)}\n` +
    `    SHIPPED and RELEASE keep these. AWARD would SILENTLY LOSE them.`,
);
console.log(`  links whose successor reported NOTHING on the boundary day: ${totNoSuccCoverage}`);
console.log('='.repeat(78));

await c.end();
