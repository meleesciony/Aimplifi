/**
 * READ-ONLY production probe — H.7: the transfer sweep pair-flips `isTransfer`
 * on SETTLED rows. Every statement is a SELECT. Nothing is written.
 *
 * The defect (TASKS H.7, executed by the #414 critic): `planTransferUpdates`'s
 * flag branch (`transfers.ts:106`) has no settled-row guard, so any new row
 * supplying a coincidental same-|amount| cross-account counterpart within ±3
 * days flips a SETTLED row's `isTransfer` to true — silently, with no category
 * change, no confidence change, no audit row and no undo. The row keeps saying
 * "Paycheck" while every income total drops it.
 *
 * The fix is a SEMANTICS decision (when may a pair-only detection rewrite a
 * settled verdict?), and the task row requires it measured on the owner's real
 * corpus rather than argued. This probe measures, using the REAL engine
 * (`detectTransfers` / `normalizeMerchant` imported, never re-implemented):
 *
 *   1. Corpus shape: rows, accounts and their types.
 *   2. THE CONTRADICTION POPULATION — rows already `isTransfer: true` that are
 *      settled (`needsReview: false`) and carry a category that is NOT
 *      'transfer'. These are rows silently withheld from totals while filed as
 *      something else. Split by whether the DESCRIPTOR alone explains the flag
 *      (legitimate, not pair-only) or only a PAIR does (the harm population).
 *   3. For every pair-only settled row: the account-type topology of its
 *      counterpart (CHECKING->CREDIT is a card payment; depository<->depository
 *      is where a coincidence hides), the date gap, how many candidate
 *      counterparts exist (a 1:1 match is evidence; a 1:N match is arbitrary),
 *      and whether the row's own category is INCOME (the critic's repro).
 *   4. WOULD-FLIP-NOW: replay `detectTransfers` over the live corpus and report
 *      settled rows it would flag that are not flagged yet.
 *   5. The C.6 artifact check: counterparts sitting on a SUPERSEDED/duplicate
 *      account, which is how a same-account refund pair (excluded by design)
 *      re-enters as a cross-account "pair".
 *
 * Dates are `String` YYYY-MM-DD columns, so L.27's driver-parsed-timestamp trap
 * does not apply.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { daysBetween, isoDate } from '../../src/lib/dates';
import { isIncomeCategoryId } from '../../src/lib/engine/categorize/categories';
import { normalizeMerchant } from '../../src/lib/engine/categorize/normalize';
import { detectTransfers, type TransferTxn } from '../../src/lib/engine/categorize/transfers';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

interface Row {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  isTransfer: boolean;
  needsReview: boolean;
  reviewPinned: boolean;
  status: string;
  categoryId: string | null;
  confidenceBps: number | null;
}

const users = await c.query<{ id: string; email: string }>(
  `select distinct u.id, u.email from "User" u
   join "Account" a on a."userId" = u.id
   where a."providerRef" is not null
   order by u.id asc`,
);
console.log(`users with linked accounts: ${users.rows.length}`);

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

for (const user of users.rows) {
  console.log(`\n===== user ${user.id} <${user.email}> =====`);

  const accounts = await c.query<{
    id: string;
    name: string;
    type: string;
    mask: string | null;
    currency: string | null;
    institutionName: string | null;
  }>(
    `select id, name, type, mask, currency, "institutionName"
     from "Account" where "userId" = $1 order by type, name`,
    [user.id],
  );
  const accById = new Map(accounts.rows.map((a) => [a.id, a]));
  const typeOf = (id: string) => accById.get(id)?.type ?? 'UNKNOWN';
  const labelOf = (id: string) => {
    const a = accById.get(id);
    return a ? `${a.type} ${a.name}${a.mask ? ` ..${a.mask}` : ''}` : `?${id}`;
  };
  console.log(`accounts: ${accounts.rows.length}`);
  const byType = new Map<string, number>();
  for (const a of accounts.rows) byType.set(a.type, (byType.get(a.type) ?? 0) + 1);
  console.log(`  by type: ${[...byType].map(([t, n]) => `${t}=${n}`).join(' ')}`);

  // The sweep's own read (transfer-refresh.ts:24-38): every non-split row.
  const rows = await c.query<Row>(
    `select t.id, t."accountId", t.date, t."amountCents", t."rawDescriptor",
            t."isTransfer", t."needsReview", t."reviewPinned", t.status,
            t."categoryId", t."confidenceBps"
     from "Transaction" t
     join "Account" a on a.id = t."accountId"
     where a."userId" = $1 and t."isSplitParent" = false
     order by t.date asc`,
    [user.id],
  );
  const txns = rows.rows;
  console.log(`transactions (non-split): ${txns.length}`);
  if (txns.length === 0) continue;
  console.log(`  date span: ${txns[0].date} .. ${txns[txns.length - 1].date}`);

  // ---- 1. Replay the REAL detector over the REAL corpus. -------------------
  const engineInput: TransferTxn[] = txns.map((t) => ({
    id: t.id,
    accountId: t.accountId,
    date: t.date,
    amountCents: t.amountCents,
    rawDescriptor: t.rawDescriptor,
  }));
  const detected = detectTransfers(engineInput);
  console.log(`\ndetectTransfers over the live corpus: ${detected.size} rows detected`);

  // Descriptor-only detection: what the normalizer alone explains.
  const descriptorDetected = new Set<string>();
  for (const t of txns) {
    const cat = normalizeMerchant(t.rawDescriptor).categoryId;
    if (cat === 'transfer' || cat === 'auto-loan') descriptorDetected.add(t.id);
  }
  const pairOnly = new Set([...detected].filter((id) => !descriptorDetected.has(id)));
  console.log(`  descriptor-explained: ${descriptorDetected.size}   PAIR-ONLY: ${pairOnly.size}`);

  // ---- 2. The contradiction population. ------------------------------------
  const flaggedSettledNonTransfer = txns.filter(
    (t) => t.isTransfer && !t.needsReview && t.categoryId !== 'transfer',
  );
  console.log(
    `\nCONTRADICTION POPULATION (isTransfer=true, settled, category<>'transfer'): ${flaggedSettledNonTransfer.length}`,
  );
  let inflow = 0;
  let outflow = 0;
  const catCount = new Map<string, number>();
  const catCents = new Map<string, number>();
  for (const t of flaggedSettledNonTransfer) {
    if (t.amountCents > 0) inflow += t.amountCents;
    else outflow += -t.amountCents;
    const k = t.categoryId ?? '(null)';
    catCount.set(k, (catCount.get(k) ?? 0) + 1);
    catCents.set(k, (catCents.get(k) ?? 0) + Math.abs(t.amountCents));
  }
  console.log(`  inflow withheld:  ${usd(inflow)}`);
  console.log(`  outflow withheld: ${usd(outflow)}`);
  console.log(`  by category:`);
  for (const [k, n] of [...catCount].sort((a, b) => b[1] - a[1])) {
    const income = k !== '(null)' && isIncomeCategoryId(k) ? '  <-- INCOME' : '';
    console.log(
      `    ${k.padEnd(24)} n=${String(n).padStart(4)}  ${usd(catCents.get(k) ?? 0).padStart(14)}${income}`,
    );
  }

  // The harm population: contradiction rows the DESCRIPTOR does not explain.
  const harm = flaggedSettledNonTransfer.filter((t) => !descriptorDetected.has(t.id));
  console.log(`\n  of which PAIR-ONLY (descriptor does not explain the flag): ${harm.length}`);
  const harmIncome = harm.filter((t) => t.categoryId && isIncomeCategoryId(t.categoryId));
  console.log(
    `  of which carry an INCOME category (the critic's repro shape): ${harmIncome.length}  ${usd(
      harmIncome.reduce((s, t) => s + Math.abs(t.amountCents), 0),
    )}`,
  );

  // ---- 3. Counterpart evidence for every pair-only settled row. ------------
  const byAbsAmount = new Map<number, Row[]>();
  for (const t of txns) {
    const k = Math.abs(t.amountCents);
    const l = byAbsAmount.get(k) ?? [];
    l.push(t);
    byAbsAmount.set(k, l);
  }
  function counterparts(t: Row): Row[] {
    const group = byAbsAmount.get(Math.abs(t.amountCents)) ?? [];
    return group.filter(
      (o) =>
        o.id !== t.id &&
        o.accountId !== t.accountId &&
        Math.sign(o.amountCents) === -Math.sign(t.amountCents) &&
        Math.abs(daysBetween(isoDate(t.date), isoDate(o.date))) <= 3,
    );
  }

  const topology = new Map<string, number>();
  const gapDist = new Map<number, number>();
  const ambiguity = new Map<number, number>();
  let roundAmounts = 0;
  for (const t of harm) {
    const cps = counterparts(t);
    ambiguity.set(cps.length, (ambiguity.get(cps.length) ?? 0) + 1);
    if (Math.abs(t.amountCents) % 10_000 === 0) roundAmounts += 1;
    for (const cp of cps) {
      const from = t.amountCents < 0 ? typeOf(t.accountId) : typeOf(cp.accountId);
      const to = t.amountCents < 0 ? typeOf(cp.accountId) : typeOf(t.accountId);
      const key = `${from} -> ${to}`;
      topology.set(key, (topology.get(key) ?? 0) + 1);
      const gap = Math.abs(daysBetween(isoDate(t.date), isoDate(cp.date)));
      gapDist.set(gap, (gapDist.get(gap) ?? 0) + 1);
    }
  }
  console.log(`\n  counterpart TOPOLOGY (outflow-account -> inflow-account), pair-only settled rows:`);
  for (const [k, n] of [...topology].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(28)} ${n}`);
  }
  console.log(
    `  date-gap distribution: ${[...gapDist]
      .sort((a, b) => a[0] - b[0])
      .map(([g, n]) => `${g}d=${n}`)
      .join(' ')}`,
  );
  console.log(
    `  MATCH AMBIGUITY (how many counterparts each row has): ${[...ambiguity]
      .sort((a, b) => a[0] - b[0])
      .map(([k, n]) => `${k}cp=${n}`)
      .join(' ')}`,
  );
  console.log(`  round ($100-multiple) amounts among them: ${roundAmounts}/${harm.length}`);

  console.log(`\n  SAMPLE — pair-only settled rows carrying a NON-transfer category (up to 25):`);
  for (const t of harm.slice(0, 25)) {
    const cps = counterparts(t);
    const cpDesc = cps
      .slice(0, 3)
      .map(
        (cp) =>
          `${cp.date} ${labelOf(cp.accountId)} "${cp.rawDescriptor.slice(0, 34)}" [${cp.categoryId ?? 'null'}${
            cp.needsReview ? ' NEEDS-REVIEW' : ''
          }]`,
      )
      .join(' | ');
    console.log(
      `    ${t.date} ${usd(t.amountCents).padStart(13)} ${labelOf(t.accountId).padEnd(26)} "${t.rawDescriptor.slice(
        0,
        34,
      )}" cat=${t.categoryId ?? 'null'} conf=${t.confidenceBps ?? '-'}`,
    );
    console.log(`        counterparts(${cps.length}): ${cpDesc || '(none - flag predates current corpus)'}`);
  }

  // ---- 4. Would the sweep flip a settled row RIGHT NOW? --------------------
  const wouldFlip = txns.filter((t) => detected.has(t.id) && !t.isTransfer);
  const wouldFlipSettled = wouldFlip.filter((t) => !t.needsReview);
  console.log(
    `\nWOULD-FLIP-NOW: ${wouldFlip.length} rows the sweep would newly flag; ${wouldFlipSettled.length} of them are SETTLED`,
  );
  for (const t of wouldFlipSettled.slice(0, 15)) {
    console.log(
      `    ${t.date} ${usd(t.amountCents).padStart(13)} ${labelOf(t.accountId).padEnd(26)} "${t.rawDescriptor.slice(
        0,
        34,
      )}" cat=${t.categoryId ?? 'null'}`,
    );
  }

  // ---- 5. The C.6 artifact: counterparts on a superseded/duplicate account. -
  let superseded = new Set<string>();
  let reconCount = 0;
  try {
    const recon = await c.query<{ predecessorId: string; status: string }>(
      `select "predecessorAccountId" as "predecessorId", status
       from "AccountReconciliation" where "userId" = $1`,
      [user.id],
    );
    reconCount = recon.rows.length;
    superseded = new Set(recon.rows.map((r) => r.predecessorId));
  } catch (e) {
    console.log(`  (AccountReconciliation not readable: ${(e as Error).message.slice(0, 80)})`);
  }
  console.log(`\nreconciliations: ${reconCount}  superseded predecessor accounts: ${superseded.size}`);
  let crossSuperseded = 0;
  for (const t of harm) {
    for (const cp of counterparts(t)) {
      if (superseded.has(cp.accountId) || superseded.has(t.accountId)) {
        crossSuperseded += 1;
        break;
      }
    }
  }
  console.log(`  pair-only settled rows whose match involves a superseded account: ${crossSuperseded}`);

  let sameMerchantPairs = 0;
  for (const t of harm) {
    const m = normalizeMerchant(t.rawDescriptor).canonical;
    for (const cp of counterparts(t)) {
      if (normalizeMerchant(cp.rawDescriptor).canonical === m) {
        sameMerchantPairs += 1;
        break;
      }
    }
  }
  console.log(`  pair-only settled rows matched to the SAME MERCHANT (refund shape, C.6): ${sameMerchantPairs}`);
}

await c.end();
console.log('\ndone - read-only, nothing written.');
