/**
 * U.17 — READ-ONLY: when a predecessor went quiet months before the cutover,
 * is the released "handover day" that last-used date, and what would each
 * prescribed fix do to real rows?
 *
 * claimEnd = min(cutover, predecessor last). U.13 releases that day to both
 * sides. When last === cutover the rationale holds (the feed stopped mid-day).
 * When last < cutover the released day is the last day the card was USED, which
 * can be months before the reconnect, and copy that calls it a changeover is
 * false. The row asks two remedies:
 *
 *   A  do not release the last-used day when last < cutover
 *      (predecessor owns [first, last] inclusive; successor rows that day drop)
 *   B  set claimEnd to the cutover even when last is earlier
 *      (successor rows in [last, cutover) drop — the F4 gap)
 *
 * This probe measures what each PRODUCES on the owner's live corpus.
 * Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u17-dormant-handover.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { compareDates, daysBetween, isoDate } from '../../src/lib/dates';
import { effectiveReconciliationLinks } from '../../src/lib/engine/account/reconcile-boundary';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const money = (n: number) =>
  `${n < 0 ? '-' : ''}$${(Math.abs(n) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const asDay = (v: unknown): string => String(v).slice(0, 10);

interface Acct {
  id: string;
  userId: string;
  name: string;
  type: string;
}
interface Txn {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
}

const accounts = (
  await c.query(`SELECT id, "userId", name, type FROM "Account"`)
).rows as Acct[];
const links = (
  await c.query(
    `SELECT "userId", "predecessorAccountId", "successorAccountId", "cutoverDate"
       FROM "AccountReconciliation" WHERE "undoneAt" IS NULL`,
  )
).rows as {
  userId: string;
  predecessorAccountId: string;
  successorAccountId: string;
  cutoverDate: unknown;
}[];

const byUser = new Map<string, Acct[]>();
for (const a of accounts) {
  if (!byUser.has(a.userId)) byUser.set(a.userId, []);
  byUser.get(a.userId)!.push(a);
}

console.log('='.repeat(78));
console.log('U.17 — DORMANT PREDECESSOR HANDOVER DAY (production, read-only)');
console.log('='.repeat(78));

type Shape = 'coincident' | 'dormant' | 'cutover-before-last' | 'degenerate';

let nEff = 0;
const byShape: Record<Shape, number> = {
  coincident: 0,
  dormant: 0,
  'cutover-before-last': 0,
  degenerate: 0,
};

let dormantGapDays = 0;
let dormantMaxGap = 0;
let aLostRows = 0;
let aLostCents = 0;
let aMatchedWouldUndouble = 0;
let aMatchedCents = 0;
let bLostRows = 0;
let bLostCents = 0;
let dormantReleasedMatched = 0;
let dormantReleasedMatchedCents = 0;
let dormantReleasedSuccOnly = 0;
let dormantReleasedPredOnly = 0;

for (const [userId, userAccounts] of byUser) {
  const userLinks = links.filter((l) => l.userId === userId);
  if (!userLinks.length) continue;
  const eff = effectiveReconciliationLinks(userAccounts, userLinks);
  if (!eff.length) continue;
  nEff += eff.length;

  const ids = new Set<string>();
  for (const l of eff) {
    ids.add(l.predecessorAccountId);
    ids.add(l.successorAccountId);
  }
  const txns = (
    await c.query(
      `SELECT id, "accountId", date, "amountCents", "rawDescriptor"
         FROM "Transaction"
        WHERE "accountId" = ANY($1::text[]) AND "isSplitParent" = false
        ORDER BY date, id`,
      [[...ids]],
    )
  ).rows as Txn[];

  const rowsByAcct = new Map<string, Txn[]>();
  for (const t of txns) {
    t.date = asDay(t.date);
    if (!rowsByAcct.has(t.accountId)) rowsByAcct.set(t.accountId, []);
    rowsByAcct.get(t.accountId)!.push(t);
  }
  const nameOf = new Map(userAccounts.map((a) => [a.id, a.name]));

  console.log(`\nuser ${userId}: ${eff.length} effective links`);

  for (const l of eff) {
    const predRows = rowsByAcct.get(l.predecessorAccountId) ?? [];
    const succRows = rowsByAcct.get(l.successorAccountId) ?? [];
    const cut = isoDate(asDay(l.cutoverDate));
    const predName = (nameOf.get(l.predecessorAccountId) ?? l.predecessorAccountId).slice(0, 28);
    const succName = (nameOf.get(l.successorAccountId) ?? l.successorAccountId).slice(0, 22);

    if (!predRows.length) {
      byShape.degenerate += 1;
      console.log(`  ${predName.padEnd(28)} -> ${succName.padEnd(22)}  no pred rows (no claim)`);
      continue;
    }
    const first = isoDate(predRows[0]!.date);
    const last = isoDate(predRows[predRows.length - 1]!.date);
    if (compareDates(cut, first) < 0) {
      byShape.degenerate += 1;
      console.log(
        `  ${predName.padEnd(28)} -> ${succName.padEnd(22)}  DEGENERATE cut ${cut} < first ${first}`,
      );
      continue;
    }

    const released = compareDates(cut, last) < 0 ? cut : last;
    const shape: Shape =
      compareDates(last, cut) === 0
        ? 'coincident'
        : compareDates(last, cut) < 0
          ? 'dormant'
          : 'cutover-before-last';
    byShape[shape] += 1;

    const predDay = predRows.filter((t) => t.date === released);
    const succDay = succRows.filter((t) => t.date === released);
    const usedPred = new Set<string>();
    const matched: Txn[] = [];
    const succOnly: Txn[] = [];
    for (const s of succDay) {
      const m = predDay.find(
        (p) => !usedPred.has(p.id) && Math.abs(p.amountCents) === Math.abs(s.amountCents),
      );
      if (m) {
        usedPred.add(m.id);
        matched.push(s);
      } else succOnly.push(s);
    }
    const predOnly = predDay.filter((p) => !usedPred.has(p.id));

    const gap = daysBetween(last, cut);
    if (shape === 'dormant') {
      dormantGapDays += gap;
      if (gap > dormantMaxGap) dormantMaxGap = gap;
      dormantReleasedMatched += matched.length;
      dormantReleasedMatchedCents += matched.reduce((s, t) => s + Math.abs(t.amountCents), 0);
      dormantReleasedSuccOnly += succOnly.length;
      dormantReleasedPredOnly += predOnly.length;
      aLostRows += succOnly.length;
      aLostCents += succOnly.reduce((s, t) => s + Math.abs(t.amountCents), 0);
      aMatchedWouldUndouble += matched.length;
      aMatchedCents += matched.reduce((s, t) => s + Math.abs(t.amountCents), 0);
      const gapRows = succRows.filter(
        (t) => compareDates(isoDate(t.date), last) > 0 && compareDates(isoDate(t.date), cut) < 0,
      );
      // B also drops the released day itself (now in [last, cutover)).
      const bDayAndGap = [...succDay, ...gapRows];
      bLostRows += bDayAndGap.length;
      bLostCents += bDayAndGap.reduce((s, t) => s + Math.abs(t.amountCents), 0);
    }

    console.log(
      `  ${predName.padEnd(28)} -> ${succName.padEnd(22)}  ` +
        `${shape.padEnd(20)} last=${last} cut=${cut} released=${released}` +
        (shape === 'dormant' ? ` gap=${gap}d` : ''),
    );
    console.log(
      `    released-day pred ${predDay.length} | succ ${succDay.length} | ` +
        `matched ${matched.length} | succ-only ${succOnly.length} | pred-only ${predOnly.length}`,
    );
    if (shape === 'dormant') {
      for (const t of succOnly)
        console.log(
          `      A would SILENTLY DROP  ${t.date} ${money(t.amountCents).padStart(12)}  ${t.rawDescriptor.slice(0, 48)}`,
        );
      for (const t of matched)
        console.log(
          `      A would undouble       ${t.date} ${money(t.amountCents).padStart(12)}  ${t.rawDescriptor.slice(0, 48)}`,
        );
      const gapRows = succRows.filter(
        (t) => compareDates(isoDate(t.date), last) > 0 && compareDates(isoDate(t.date), cut) < 0,
      );
      console.log(
        `      B would drop released-day succ ${succDay.length} + gap ${gapRows.length} ` +
          `(${money(succDay.concat(gapRows).reduce((s, t) => s + Math.abs(t.amountCents), 0))})`,
      );
    }
  }
}

console.log('\n' + '='.repeat(78));
console.log('SHAPES');
console.log(`  effective links: ${nEff}`);
console.log(`  coincident (last === cutover):     ${byShape.coincident}`);
console.log(`  dormant (last < cutover):          ${byShape.dormant}`);
console.log(`  cutover-before-last (user dragged): ${byShape['cutover-before-last']}`);
console.log(`  degenerate / no pred rows:         ${byShape.degenerate}`);
if (byShape.dormant > 0) {
  console.log(
    `  dormant gap: max ${dormantMaxGap}d, mean ${Math.round(dormantGapDays / byShape.dormant)}d`,
  );
}

console.log('\nDORMANT RELEASED DAYS (current rule: last-used day is the handover day)');
console.log(
  `  matched pairs (visible doubles today): ${dormantReleasedMatched} / ${money(dormantReleasedMatchedCents)}`,
);
console.log(`  succ-only on that day: ${dormantReleasedSuccOnly}`);
console.log(`  pred-only on that day: ${dormantReleasedPredOnly}`);

console.log('\nFIX A — do not release last-used day when last < cutover');
console.log(
  `  silently drops succ-only rows: ${aLostRows} / ${money(aLostCents)}`,
);
console.log(
  `  undoubles matched pairs (pred wins): ${aMatchedWouldUndouble} / ${money(aMatchedCents)}`,
);

console.log('\nFIX B — claimEnd = cutover even when last is earlier (F4 inverted)');
console.log(
  `  silently drops successor rows on released day + gap: ${bLostRows} / ${money(bLostCents)}`,
);
console.log('='.repeat(78));

await c.end();
