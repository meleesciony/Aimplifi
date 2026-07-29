/**
 * READ-ONLY production replay (TASKS O.12a). Reproduces `getTriageGroups`
 * (src/server/triage.ts:251) statement for statement over the owner's LIVE rows,
 * importing the REAL engines — only the Prisma calls are swapped for the same
 * queries in raw SQL, because the local Prisma client is generated against the
 * SQLite schema and cannot open a Postgres connection.
 *
 * WHY THIS EXISTS: the Wave O.12 diagnosis measured `needsReview = true` joined
 * to Account with NO account-type filter, and concluded that 374 INVESTMENT rows
 * were burying the queue. But all three triage entry points already scope to
 * SPENDING_ACCOUNT_TYPES (triage.ts:102, :260, :368), so those rows never reach
 * the inbox at all. This probe measures the set the reader can actually see, and
 * prints the queue predicate clause by clause so it is visible which one removes
 * what.
 *
 * FIDELITY GAP, stated rather than hidden: `getReconciliationTxnKeep` is applied
 * in JS after the query and is not reproduced here. The probe counts the owner's
 * AccountReconciliation rows instead — at zero, that filter is the documented
 * constant-true fast path (R8) and this replay is exact.
 *
 * CREDENTIALS: reads `.env.prod.tmp` (gitignored). Delete it when done.
 * Usage: npx tsx scripts/audit-probes/o12-what-the-inbox-actually-holds.ts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { type ReviewRow, groupReviewRows } from '@/lib/engine/categorize/group';
import { deriveLearnedRules, type LearnedCorrectionInput } from '@/lib/engine/categorize/learn';
import { proposeCategory } from '@/lib/engine/categorize/propose';
import { tuneFlaggedThreshold } from '@/lib/engine/categorize/tuning';
import { toRuleLike, type RuleRow } from '@/server/rules';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';

const OWNER = process.env.REPLAY_USER_ID ?? 'cmqisanqh000004l7wylnhrpd';

function dbUrl(): string {
  const env = readFileSync('.env.prod.tmp', 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL missing from .env.prod.tmp');
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}

/** The queue's account clause, verbatim from triage.ts:260, as SQL. */
const ACCOUNT_CLAUSE = `a."userId" = $1
     and a."type" = any($2::text[])
     and (a."currency" is null or a."currency" = 'USD')`;

async function main() {
  const c = new pg.Client({ connectionString: dbUrl() });
  await c.connect();
  const types = [...SPENDING_ACCOUNT_TYPES];

  const count = async (sql: string, params: unknown[]) =>
    Number((await c.query(sql, params)).rows[0].n);

  const rawNeedsReview = await count(
    `select count(*)::int as n from "Transaction" t join "Account" a on a.id = t."accountId"
      where a."userId" = $1 and t."needsReview" = true`,
    [OWNER],
  );
  const afterType = await count(
    `select count(*)::int as n from "Transaction" t join "Account" a on a.id = t."accountId"
      where a."userId" = $1 and a."type" = any($2::text[]) and t."needsReview" = true`,
    [OWNER, types],
  );
  const afterCurrency = await count(
    `select count(*)::int as n from "Transaction" t join "Account" a on a.id = t."accountId"
      where ${ACCOUNT_CLAUSE} and t."needsReview" = true`,
    [OWNER, types],
  );

  // The full queue predicate — transfer guard included (pin wins, #148).
  const rows = (
    await c.query(
      `select t.id, t."accountId", t."merchantId", t."rawDescriptor", t."amountCents",
              t."date", t."status", t."providerCategoryId", m."canonical" as merchant_canonical
         from "Transaction" t
         join "Account" a on a.id = t."accountId"
         left join "Merchant" m on m.id = t."merchantId"
        where ${ACCOUNT_CLAUSE}
          and t."needsReview" = true
          and (t."isTransfer" = false or t."reviewPinned" = true)
        order by t."date" desc, t.id desc`,
      [OWNER, types],
    )
  ).rows;

  const reconciliations = await count(
    `select count(*)::int as n from "AccountReconciliation"
      where "userId" = $1 and "undoneAt" is null`,
    [OWNER],
  );

  // ---- the same three loaders getTriageGroups awaits, in raw SQL ----
  const ruleRows: RuleRow[] = (
    await c.query(
      `select id, "merchantId", "minAmountCents", "maxAmountCents", "weekendOnly",
              "weekdayOnly", "accountId", "categoryId", priority
         from "CategorizationRule" where "userId" = $1`,
      [OWNER],
    )
  ).rows;
  const canonicalById = new Map<string, string>(
    (
      await c.query(`select id, canonical from "Merchant" where id = any($1::text[])`, [
        [...new Set(ruleRows.map((r) => r.merchantId).filter((x): x is string => !!x))],
      ])
    ).rows.map((m) => [m.id as string, m.canonical as string]),
  );
  const explicitRules = ruleRows.map((r) => toRuleLike(r, canonicalById)).filter((r) => r !== null);

  const corrRows = (
    await c.query(
      `select cr."transactionId", cr."toCategoryId", cr."undoesId",
              t."rawDescriptor", t."amountCents"
         from "Correction" cr join "Transaction" t on t.id = cr."transactionId"
         join "Account" a on a.id = t."accountId"
        where cr."userId" = $1 and a."userId" = $1
        order by cr."createdAt" asc`,
      [OWNER],
    )
  ).rows;
  const corrections: LearnedCorrectionInput[] = corrRows.map((r, i) => ({
    transactionId: r.transactionId,
    toCategoryId: r.toCategoryId,
    isUndo: r.undoesId != null,
    seq: i,
    rawDescriptor: r.rawDescriptor,
    amountCents: Number(r.amountCents),
  }));
  const rules = [...explicitRules, ...deriveLearnedRules(corrections)];

  const predRows = (
    await c.query(
      `select "predictedCategoryId", "confidenceBps", "actualCategoryId"
         from "CategoryPrediction"
        where "userId" = $1 and "actualCategoryId" is not null and "labeledAt" is not null
        order by "labeledAt" asc, id asc`,
      [OWNER],
    )
  ).rows;
  const tuning = tuneFlaggedThreshold(
    predRows.map((p) => ({
      predictedCategoryId: p.predictedCategoryId,
      confidenceBps: Number(p.confidenceBps),
      actualCategoryId: p.actualCategoryId as string,
    })),
  );

  await c.end();

  // ---- getTriageGroups' own body, unchanged ----
  const reviewRows: ReviewRow[] = rows.map((t) => {
    const out = categorize(
      {
        rawDescriptor: t.rawDescriptor,
        amountCents: Number(t.amountCents),
        date: t.date,
        accountId: t.accountId,
      },
      rules,
      { flaggedBps: tuning.flaggedBps },
    );
    return {
      id: t.id,
      merchantId: t.merchantId,
      merchantCanonical: t.merchant_canonical ?? out.merchantCanonical,
      rawDescriptor: t.rawDescriptor,
      amountCents: Number(t.amountCents),
      date: t.date,
      accountName: '',
      status: t.status,
      aggregate: normalizeMerchant(t.rawDescriptor).aggregate,
      suggestedCategoryId: out.categoryId === 'uncategorized' ? null : out.categoryId,
      providerCategoryId: t.providerCategoryId,
    };
  });

  const groups = groupReviewRows(reviewRows).map((g) => {
    // unanimousProposal (triage.ts:197), inlined — it is not exported.
    let proposed: string | null = null;
    if (g.suggestedCategoryId === null && g.providerSuggestedCategoryId === null) {
      const ps = g.rows.map((r) =>
        proposeCategory({ rawDescriptor: r.rawDescriptor, amountCents: r.amountCents }, corrections),
      );
      if (!ps.some((p) => p === null)) {
        const cats = new Set(ps.map((p) => p!.categoryId));
        if (cats.size === 1) proposed = ps[0]!.categoryId;
      }
    }
    return { ...g, proposedCategoryId: proposed };
  });

  const withRuleset = groups.filter((g) => g.suggestedCategoryId !== null);
  const withProvider = groups.filter(
    (g) => g.suggestedCategoryId === null && g.providerSuggestedCategoryId !== null,
  );
  const withProposal = groups.filter((g) => g.proposedCategoryId !== null);
  const withNothing = groups.filter(
    (g) =>
      g.suggestedCategoryId === null &&
      g.providerSuggestedCategoryId === null &&
      g.proposedCategoryId === null,
  );

  console.log(`\n=== the set the O.12 diagnosis measured (NO account-type scope) ===`);
  console.log(`  needsReview rows, every account type   : ${rawNeedsReview}`);
  console.log(`\n=== the queue's OWN predicate, clause by clause ===`);
  console.log(`  after type in ${types.join('/')}  : ${afterType}   (removed ${rawNeedsReview - afterType})`);
  console.log(`  after the USD currency guard           : ${afterCurrency}   (removed ${afterType - afterCurrency})`);
  console.log(`  after the transfer guard (pin wins)    : ${rows.length}   (removed ${afterCurrency - rows.length})`);
  console.log(`  owner AccountReconciliation rows       : ${reconciliations}  ${reconciliations === 0 ? '(keep-rule is the R8 constant-true fast path — replay is exact)' : '(NOT reproduced here — replay is an UPPER BOUND)'}`);
  console.log(`\n=== what the inbox therefore holds ===`);
  console.log(`  rows                                   : ${rows.length}`);
  console.log(`  merchant GROUPS (= the nav badge)      : ${groups.length}`);
  console.log(`  explicit rules loaded                  : ${explicitRules.length}`);
  console.log(`  corrections loaded                     : ${corrections.length}`);
  console.log(`  learned rules derived                  : ${rules.length - explicitRules.length}`);
  console.log(`\n=== how many groups offer the reader something ===`);
  console.log(`  our own ruleset suggestion             : ${withRuleset.length}`);
  console.log(`  Plaid's guess (ruleset silent)         : ${withProvider.length}`);
  console.log(`  O.9 proposal ("Looks like …")          : ${withProposal.length}`);
  console.log(`  NOTHING — the reader decides unaided   : ${withNothing.length}`);

  console.log(`\n=== the 15 biggest groups offering NOTHING ===`);
  for (const g of [...withNothing].sort((a, b) => b.count - a.count).slice(0, 15)) {
    console.log(
      `  ${String(g.count).padStart(3)} rows  agg=${g.aggregate ? 'Y' : 'n'}  ${g.merchantCanonical.slice(0, 34).padEnd(34)} | ${g.variants[0]?.slice(0, 40)}`,
    );
  }

  console.log(`\n=== every group that DOES offer a proposal ===`);
  for (const g of withProposal) {
    console.log(`  ${String(g.count).padStart(3)} rows  ${g.merchantCanonical} -> ${g.proposedCategoryId}`);
  }

  // ---- WHY is the ruleset silent on all 89? Bucket the groups by the reason ----
  // Corrections keyed the way the learner keys them: by normalized canonical.
  const corrByCanonical = new Map<string, Set<string>>();
  const corrCount = new Map<string, number>();
  for (const c of corrections) {
    if (c.isUndo) continue;
    const key = normalizeMerchant(c.rawDescriptor).canonical;
    if (!corrByCanonical.has(key)) corrByCanonical.set(key, new Set());
    corrByCanonical.get(key)!.add(c.toCategoryId);
    corrCount.set(key, (corrCount.get(key) ?? 0) + 1);
  }
  const learnedCanonicals = new Set(
    deriveLearnedRules(corrections)
      .map((r) => r.merchantCanonical)
      .filter((x): x is string => !!x),
  );

  const buckets = {
    aggregate_never_ruleable: 0,
    never_corrected: 0,
    one_correction_below_bar: 0,
    conflicting_categories: 0,
    unanimous_but_still_silent: 0,
  };
  const conflictExamples: string[] = [];
  const unanimousSilent: string[] = [];
  for (const g of withNothing) {
    const key = normalizeMerchant(g.variants[0] ?? g.merchantCanonical).canonical;
    const cats = corrByCanonical.get(key);
    const n = corrCount.get(key) ?? 0;
    if (g.aggregate) buckets.aggregate_never_ruleable += 1;
    else if (!cats || n === 0) buckets.never_corrected += 1;
    else if (n === 1) buckets.one_correction_below_bar += 1;
    else if (cats.size > 1) {
      buckets.conflicting_categories += 1;
      if (conflictExamples.length < 8)
        conflictExamples.push(`${g.merchantCanonical} — ${n} corrections across ${cats.size} categories`);
    } else if (!learnedCanonicals.has(key)) {
      buckets.unanimous_but_still_silent += 1;
      if (unanimousSilent.length < 8) unanimousSilent.push(`${g.merchantCanonical} — ${n} corrections, all ${[...cats][0]}`);
    } else buckets.unanimous_but_still_silent += 1;
  }

  console.log(`\n=== WHY the ruleset is silent on the ${withNothing.length} groups offering nothing ===`);
  console.table(buckets);
  if (conflictExamples.length) {
    console.log('\nconflicting-history examples (the O.12b class):');
    for (const e of conflictExamples) console.log('  ' + e);
  }
  if (unanimousSilent.length) {
    console.log('\nUNANIMOUS history but still no rule — investigate:');
    for (const e of unanimousSilent) console.log('  ' + e);
  }
}

void main();
