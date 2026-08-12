/**
 * U.11e — READ-ONLY: a per-LINK verdict on every live supersession in production.
 *
 * The U.11d run classified links by `matchSignal`/`confidence` and produced a headline
 * that does not survive inspection: the name/medium bucket contains genuine pairs
 * (Schwab "Investor Checking ...927" -> "Investor Checking" agrees on 171 of 172
 * transactions) alongside impossible ones (three distinct Schwab 529 plans continued
 * onto one Vanguard 401k). A proxy is not evidence, so this probe judges each link on
 * what can actually be checked about IT:
 *
 *   - transaction agreement inside the two sides' overlapping date range, matched
 *     exact on (date, |amount|) and again with a +/-3 day tolerance, because two feeds
 *     legitimately post one purchase a day apart (measured: PGA TOUR SUPERSTORE, 06-12
 *     vs 06-13);
 *   - the trailing account NUMBERS carried in each side's name/mask — two rows that
 *     name different account numbers are not the same account;
 *   - how far apart the two balances are.
 *
 * It prints the evidence per link and a verdict, and only then totals the money. No
 * link is called wrong on a signal alone.
 *
 * Every statement is a SELECT. Writes nothing.
 *
 *   npx tsx scripts/audit-probes/u11e-per-link-verdict.mts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

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

/** Trailing account numbers a name/mask advertises: "...383 (383)", "****5351", "(4034)". */
const digitsOf = (s: string | null): Set<string> => {
  const out = new Set<string>();
  if (!s) return out;
  for (const m of s.matchAll(/(\d{3,})/g)) out.add(m[1]);
  return out;
};

const dayDiff = (a: string, b: string) =>
  Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

interface Txn {
  accountId: string;
  date: string;
  amountCents: number;
}

const accounts = (
  await c.query(
    `SELECT id, "userId", name, type, subtype, mask, currency, "currentBalanceCents"
       FROM "Account"`,
  )
).rows as {
  id: string;
  userId: string;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  currency: string | null;
  currentBalanceCents: number;
}[];
const byId = new Map(accounts.map((a) => [a.id, a]));

const links = (
  await c.query(
    `SELECT id, "predecessorAccountId", "successorAccountId", "cutoverDate",
            "matchSignal", confidence, "confirmedByUserAt"
       FROM "AccountReconciliation" WHERE "undoneAt" IS NULL
       ORDER BY "confirmedByUserAt"`,
  )
).rows;

const allTxns = (
  await c.query(
    `SELECT "accountId", date, "amountCents" FROM "Transaction" WHERE "isSplitParent" = false`,
  )
).rows as Txn[];
const txnsOf = new Map<string, Txn[]>();
for (const t of allTxns) {
  if (!txnsOf.has(t.accountId)) txnsOf.set(t.accountId, []);
  txnsOf.get(t.accountId)!.push(t);
}

console.log('='.repeat(78));
console.log('U.11e — PER-LINK VERDICT ON EVERY LIVE SUPERSESSION (production, read-only)');
console.log('='.repeat(78));

const wrong: { link: (typeof links)[number]; why: string }[] = [];
const ok: typeof links = [];
const untestable: { link: (typeof links)[number]; why: string }[] = [];

for (const l of links) {
  const p = byId.get(l.predecessorAccountId);
  const s = byId.get(l.successorAccountId);
  console.log('\n' + '-'.repeat(78));
  if (!p || !s) {
    console.log(
      `LINK ${l.id.slice(-6)}  *** a side has NO Account row *** ` +
        `pred=${p ? 'ok' : 'MISSING'} succ=${s ? 'ok' : 'MISSING'} (link is inert, R7)`,
    );
    untestable.push({ link: l, why: 'an account row is missing — the link is already inert' });
    continue;
  }
  console.log(`LINK ${l.id.slice(-6)}  signal=${l.matchSignal} confidence=${l.confidence} cutover=${l.cutoverDate}`);
  console.log(`  PRED ${p.name}`);
  console.log(`       type=${p.type}/${p.subtype ?? '-'} mask=${p.mask ?? '-'} balance=${money(p.currentBalanceCents)}`);
  console.log(`  SUCC ${s.name}`);
  console.log(`       type=${s.type}/${s.subtype ?? '-'} mask=${s.mask ?? '-'} balance=${money(s.currentBalanceCents)}`);

  // --- account numbers advertised by each side --------------------------
  const pd = new Set([...digitsOf(p.name), ...digitsOf(p.mask)]);
  const sd = new Set([...digitsOf(s.name), ...digitsOf(s.mask)]);
  // Providers truncate to different lengths for the SAME account: Schwab renders
  // "...383" where Plaid's mask is "7383". So a shared account number means one
  // side's digits are a SUFFIX of the other's, never string equality — the first
  // draft of this probe used equality and called a genuine $898,889.99 brokerage
  // pair WRONG on that alone.
  const suffixMatch = (a: string, b: string) => a === b || a.endsWith(b) || b.endsWith(a);
  const shared = [...pd].filter((d) => [...sd].some((e) => suffixMatch(d, e)));
  const numbersConflict = pd.size > 0 && sd.size > 0 && shared.length === 0;
  console.log(
    `  NUMBERS pred{${[...pd].join(',') || '-'}} succ{${[...sd].join(',') || '-'}}` +
      (shared.length ? ` shared{${shared.join(',')}}` : numbersConflict ? '  ==> NO SHARED ACCOUNT NUMBER' : ''),
  );

  // --- transaction agreement in the overlap ------------------------------
  const A = (txnsOf.get(p.id) ?? []).slice().sort((x, y) => x.date.localeCompare(y.date));
  const B = (txnsOf.get(s.id) ?? []).slice().sort((x, y) => x.date.localeCompare(y.date));
  let agreementLine = '  OVERLAP no rows on one side — agreement untestable';
  let exactPct: number | null = null;
  let tolPct: number | null = null;
  if (A.length && B.length) {
    const lo = A[0].date > B[0].date ? A[0].date : B[0].date;
    const hi =
      A[A.length - 1].date < B[B.length - 1].date ? A[A.length - 1].date : B[B.length - 1].date;
    if (lo > hi) {
      agreementLine = `  OVERLAP none (${A[0].date}..${A[A.length - 1].date} vs ${B[0].date}..${B[B.length - 1].date})`;
    } else {
      const inA = A.filter((r) => r.date >= lo && r.date <= hi);
      const inB = B.filter((r) => r.date >= lo && r.date <= hi);
      // exact (date, amount)
      const pool = new Map<string, number>();
      for (const r of inB) {
        const k = `${r.date}|${r.amountCents}`;
        pool.set(k, (pool.get(k) ?? 0) + 1);
      }
      let exact = 0;
      for (const r of inA) {
        const k = `${r.date}|${r.amountCents}`;
        const n = pool.get(k) ?? 0;
        if (n > 0) {
          pool.set(k, n - 1);
          exact++;
        }
      }
      // +/-3 day tolerance on equal amount
      const remainingB = inB.slice();
      let tol = 0;
      for (const r of inA) {
        const i = remainingB.findIndex(
          (q) => q.amountCents === r.amountCents && dayDiff(q.date, r.date) <= 3,
        );
        if (i >= 0) {
          remainingB.splice(i, 1);
          tol++;
        }
      }
      const denom = Math.min(inA.length, inB.length) || 1;
      exactPct = (exact / denom) * 100;
      tolPct = (tol / denom) * 100;
      agreementLine =
        `  OVERLAP ${lo}..${hi}: pred ${inA.length} rows, succ ${inB.length} rows — ` +
        `${exact} exact (${exactPct.toFixed(1)}%), ${tol} within +/-3d (${tolPct.toFixed(1)}%)`;
    }
  }
  console.log(agreementLine);

  const balGap = Math.abs(p.currentBalanceCents - s.currentBalanceCents);
  console.log(`  BALANCE gap ${money(balGap)}`);

  // --- verdict -----------------------------------------------------------
  let verdict: string;
  if (tolPct !== null && tolPct >= 80) {
    verdict = 'GENUINE — the two feeds report the same transactions';
    ok.push(l);
  } else if (tolPct !== null && tolPct < 20) {
    const why =
      `the two sides share ${tolPct.toFixed(0)}% of their transactions inside the overlap` +
      (numbersConflict ? ' and advertise different account numbers' : '');
    verdict = `WRONG — ${why}`;
    wrong.push({ link: l, why });
  } else if (numbersConflict) {
    const why = 'the two sides advertise different account numbers and no transaction overlap can test it';
    verdict = `WRONG — ${why}`;
    wrong.push({ link: l, why });
  } else {
    verdict = 'UNTESTABLE — no overlapping rows and no conflicting account number';
    untestable.push({ link: l, why: 'no overlapping rows and no conflicting account number' });
  }
  console.log(`  VERDICT ${verdict}`);
}

console.log('\n' + '='.repeat(78));
console.log('SUMMARY');
console.log(`  links judged GENUINE   : ${ok.length}`);
console.log(`  links judged WRONG     : ${wrong.length}`);
console.log(`  links UNTESTABLE       : ${untestable.length}`);

let wrongCents = 0;
if (wrong.length) {
  console.log('\n  WRONG links — the predecessor balance each one removes from net worth:');
  for (const { link, why } of wrong) {
    const p = byId.get(link.predecessorAccountId)!;
    const s = byId.get(link.successorAccountId)!;
    wrongCents += p.currentBalanceCents;
    console.log(`    ${money(p.currentBalanceCents).padStart(14)}  ${p.name}`);
    console.log(`    ${''.padStart(14)}  superseded by "${s.name}" — ${why}`);
  }
  console.log(`\n  TOTAL removed from net worth by links this probe can PROVE wrong: ${money(wrongCents)}`);
}
if (untestable.length) {
  console.log('\n  UNTESTABLE links (stated, not counted — they need the owner to say):');
  for (const { link, why } of untestable) {
    const p = byId.get(link.predecessorAccountId);
    const s = byId.get(link.successorAccountId);
    console.log(
      `    ${money(p?.currentBalanceCents ?? 0).padStart(14)}  ${p?.name ?? link.predecessorAccountId}` +
        `\n    ${''.padStart(14)}  superseded by "${s?.name ?? link.successorAccountId}" — ${why}`,
    );
  }
}
console.log('='.repeat(78));

await c.end();
