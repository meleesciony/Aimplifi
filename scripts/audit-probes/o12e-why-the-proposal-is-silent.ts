/**
 * READ-ONLY production replay (TASKS O.12e). Sibling of
 * `o12-what-the-inbox-actually-holds.ts`, which measured that 57 of the owner's
 * 89 inbox groups offer the reader NOTHING — 10 of them aggregate channels
 * (Venmo, Cash App, checks) that can never carry a rule by design.
 *
 * THE QUESTION THIS PROBE ANSWERS, and why it is not the same question:
 * O.9b built the proposal tier for exactly that population, and it fires on 5
 * groups. Two very different facts would explain the silence on the rest, and
 * they call for opposite fixes:
 *
 *   (a) the ENGINE has nothing to say about those rows — no payee history, no
 *       repeated amount — in which case there is nothing to surface and the
 *       honest deliverable is copy, not code; or
 *   (b) the engine HAS something to say per ROW and the group tier throws it
 *       away, because `unanimousProposal` (triage.ts:197) requires every row in
 *       the group to be proposed AND to agree — a bar a 33-row Venmo group
 *       holding 33 unrelated payees can never clear.
 *
 * So this probe calls `proposeCategory` per ROW inside every silent group and
 * buckets the group by WHICH of those two it is. Nothing is written; the only
 * Prisma calls are the same reads the shipped loaders make, in raw SQL (the
 * local client is generated against SQLite and cannot open Postgres).
 *
 * FIDELITY GAP, stated rather than hidden: as in the sibling probe,
 * `getReconciliationTxnKeep` is applied in JS after the query and is not
 * reproduced, so where the owner has AccountReconciliation rows this replay is
 * an UPPER BOUND on the queue. The count is printed.
 *
 * CREDENTIALS: reads `.env.prod.tmp` (gitignored). Delete it when done.
 * Prints no email addresses and no account numbers.
 * Usage: npx tsx scripts/audit-probes/o12e-why-the-proposal-is-silent.ts
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { type ReviewRow, groupReviewRows } from '@/lib/engine/categorize/group';
import { deriveLearnedRules, type LearnedCorrectionInput } from '@/lib/engine/categorize/learn';
import { proposeCategory } from '@/lib/engine/categorize/propose';
import { registerSuggestionFor } from '@/lib/engine/categorize/register-suggestion';
import { computeDescriptorSignature, distinguishingTokens } from '@/lib/engine/categorize/signature';
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

/** propose.ts's own payee key, re-derived here (it is module-private there). */
function payeeKey(rawDescriptor: string): string {
  const tokens = distinguishingTokens(computeDescriptorSignature(rawDescriptor));
  return [...new Set(tokens)].sort().join(' ');
}

async function main() {
  const c = new pg.Client({ connectionString: dbUrl() });
  await c.connect();
  const types = [...SPENDING_ACCOUNT_TYPES];

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

  const reconciliations = Number(
    (
      await c.query(
        `select count(*)::int as n from "AccountReconciliation"
          where "userId" = $1 and "undoneAt" is null`,
        [OWNER],
      )
    ).rows[0].n,
  );

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

  const groups = groupReviewRows(reviewRows);

  // Only groups the two higher tiers are silent on can reach the proposal tier.
  const reachesProposalTier = groups.filter(
    (g) => g.suggestedCategoryId === null && g.providerSuggestedCategoryId === null,
  );

  type Measured = {
    canonical: string;
    count: number;
    aggregate: boolean;
    proposedRows: number;
    categories: Map<string, number>;
    bases: Map<string, number>;
    payeeKeys: Set<string>;
    /** Rows carrying a proposal, keyed by payee — the sub-group question. */
    payeeSubgroupsWithProposal: number;
    verdict:
      | 'group_tier_fires'
      | 'rows_disagree'
      | 'partial_some_rows_proposed'
      | 'engine_silent_on_every_row';
    samples: string[];
  };

  const measured: Measured[] = reachesProposalTier.map((g) => {
    const perRow = g.rows.map((r) => ({
      row: r,
      p: proposeCategory({ rawDescriptor: r.rawDescriptor, amountCents: r.amountCents }, corrections),
    }));
    const categories = new Map<string, number>();
    const bases = new Map<string, number>();
    const payeeKeys = new Set<string>();
    const proposedPayees = new Set<string>();
    for (const { row, p } of perRow) {
      payeeKeys.add(payeeKey(row.rawDescriptor));
      if (p) {
        categories.set(p.categoryId, (categories.get(p.categoryId) ?? 0) + 1);
        bases.set(p.basis, (bases.get(p.basis) ?? 0) + 1);
        proposedPayees.add(payeeKey(row.rawDescriptor));
      }
    }
    const proposedRows = perRow.filter((x) => x.p !== null).length;
    const verdict: Measured['verdict'] =
      proposedRows === 0
        ? 'engine_silent_on_every_row'
        : proposedRows === perRow.length
          ? categories.size === 1
            ? 'group_tier_fires'
            : 'rows_disagree'
          : 'partial_some_rows_proposed';
    return {
      canonical: g.merchantCanonical,
      count: g.count,
      aggregate: g.aggregate,
      proposedRows,
      categories,
      bases,
      payeeKeys,
      payeeSubgroupsWithProposal: proposedPayees.size,
      verdict,
      samples: g.variants.slice(0, 3),
    };
  });

  const fmt = (m: Map<string, number>) =>
    [...m.entries()].map(([k, v]) => `${k}×${v}`).join(' ') || '—';

  console.log(`\n=== scope ===`);
  console.log(`  queue rows                             : ${rows.length}`);
  console.log(`  merchant groups                        : ${groups.length}`);
  console.log(`  groups reaching the PROPOSAL tier      : ${reachesProposalTier.length}`);
  console.log(
    `  owner AccountReconciliation rows       : ${reconciliations}  ${reconciliations === 0 ? '(replay exact)' : '(replay is an UPPER BOUND)'}`,
  );
  console.log(`  corrections loaded                     : ${corrections.length}`);

  const byVerdict = new Map<string, Measured[]>();
  for (const m of measured) {
    if (!byVerdict.has(m.verdict)) byVerdict.set(m.verdict, []);
    byVerdict.get(m.verdict)!.push(m);
  }

  console.log(`\n=== WHY the proposal tier is silent, per GROUP ===`);
  for (const key of [
    'group_tier_fires',
    'rows_disagree',
    'partial_some_rows_proposed',
    'engine_silent_on_every_row',
  ] as const) {
    const list = byVerdict.get(key) ?? [];
    const rowCount = list.reduce((s, m) => s + m.count, 0);
    const proposedRowCount = list.reduce((s, m) => s + m.proposedRows, 0);
    console.log(
      `  ${key.padEnd(28)} groups=${String(list.length).padStart(3)}  rows=${String(rowCount).padStart(4)}  rows WITH a per-row proposal=${proposedRowCount}`,
    );
  }

  const throwsAway = measured.filter(
    (m) => m.verdict === 'rows_disagree' || m.verdict === 'partial_some_rows_proposed',
  );
  console.log(`\n=== THE HEADLINE: what the group gate discards ===`);
  console.log(`  groups where the engine HAS something to say but the`);
  console.log(`  group tier says nothing                : ${throwsAway.length}`);
  console.log(
    `  rows inside them already carrying a proposal today: ${throwsAway.reduce((s, m) => s + m.proposedRows, 0)} of ${throwsAway.reduce((s, m) => s + m.count, 0)}`,
  );

  console.log(`\n=== every AGGREGATE group reaching the tier (O.12e's population) ===`);
  for (const m of measured
    .filter((x) => x.aggregate)
    .sort((a, b) => b.count - a.count)) {
    console.log(
      `  ${String(m.count).padStart(3)} rows  ${m.canonical.slice(0, 22).padEnd(22)} proposed=${String(m.proposedRows).padStart(3)}  payees=${String(m.payeeKeys.size).padStart(3)}  payeesWithProposal=${String(m.payeeSubgroupsWithProposal).padStart(3)}  ${m.verdict}`,
    );
    console.log(`        cats: ${fmt(m.categories)}   bases: ${fmt(m.bases)}`);
  }

  console.log(`\n=== the 12 biggest NON-aggregate groups reaching the tier ===`);
  for (const m of measured
    .filter((x) => !x.aggregate)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)) {
    console.log(
      `  ${String(m.count).padStart(3)} rows  ${m.canonical.slice(0, 26).padEnd(26)} proposed=${String(m.proposedRows).padStart(3)}  ${m.verdict}  cats: ${fmt(m.categories)}`,
    );
  }

  // ---- Is the payee basis (documented as "what rescues an aggregate") alive? ----
  console.log(`\n=== the payee key on the biggest aggregate group ===`);
  const venmo = reachesProposalTier
    .filter((g) => g.aggregate)
    .sort((a, b) => b.count - a.count)[0];
  if (venmo) {
    const keys = new Map<string, number>();
    for (const r of venmo.rows) keys.set(payeeKey(r.rawDescriptor), (keys.get(payeeKey(r.rawDescriptor)) ?? 0) + 1);
    console.log(`  group "${venmo.merchantCanonical}", ${venmo.count} rows`);
    for (const [k, n] of keys) console.log(`    payeeKey="${k}"  (empty=${k === ''})  rows=${n}`);
    console.log(`  descriptor samples:`);
    for (const v of venmo.variants.slice(0, 4)) console.log(`    "${v}"`);
  }

  // ---- Does the REGISTER already show a chip on rows the inbox card calls "none yet"? ----
  // Same rows, the shipped per-row ladder (register-suggestion.ts), which the
  // inbox's own "One by one" drill-down does not consult.
  // A card is silent only when the GROUP-level unanimous gate produced nothing;
  // the 5 single-row groups whose card already shows a proposal are not a gap.
  const cardSilent = reachesProposalTier.filter((g) => {
    const ps = g.rows.map((r) =>
      proposeCategory({ rawDescriptor: r.rawDescriptor, amountCents: r.amountCents }, corrections),
    );
    if (ps.some((p) => p === null)) return true;
    return new Set(ps.map((p) => p!.categoryId)).size !== 1;
  });

  // `TriageGroup['rows']` is a Pick that DROPS providerCategoryId and the pipeline
  // verdict, so the ladder must read them from the ReviewRows by id. Passing null
  // instead (the first cut of this probe, caught by `next build`'s type check)
  // silently measured the provider rung as absent and made the count a LOWER
  // BOUND rather than the figure it claimed to be.
  const byId = new Map(reviewRows.map((r) => [r.id, r]));

  let registerChips = 0;
  const chipDetail: string[] = [];
  for (const g of cardSilent) {
    for (const r of g.rows) {
      const full = byId.get(r.id);
      const chip = registerSuggestionFor(
        {
          currentCategoryId: 'uncategorized',
          isTransfer: false,
          reviewPinned: false,
          pipelineCategoryId: full?.suggestedCategoryId ?? 'uncategorized',
          providerCategoryId: full?.providerCategoryId ?? null,
          txn: { rawDescriptor: r.rawDescriptor, amountCents: r.amountCents },
        },
        corrections,
      );
      if (chip === null) continue;
      registerChips += 1;
      if (chipDetail.length < 12)
        chipDetail.push(
          `${g.merchantCanonical.slice(0, 20).padEnd(20)} ${r.date} ${String(r.amountCents).padStart(8)}c -> ${chip.kind}/${chip.categoryId}${chip.proposal ? ` (${chip.proposal.basis}, support ${chip.proposal.supportCount})` : ''}`,
        );
    }
  }
  console.log(`\n=== the SURFACE inconsistency, measured ===`);
  console.log(`  groups reaching the tier                              : ${reachesProposalTier.length}`);
  console.log(`  …whose CARD is silent (no unanimous group proposal)   : ${cardSilent.length}`);
  console.log(`  rows inside those card-silent groups                  : ${cardSilent.reduce((s, g) => s + g.count, 0)}`);
  console.log(`  …of those, rows the REGISTER shows a chip on today    : ${registerChips}`);
  console.log(`  …the inbox "One by one" drill-down shows on them      : 0 (it consults no ladder)`);
  for (const d of chipDetail) console.log(`    ${d}`);

  // ---- O.12f: the masked group, measured in the same run ----
  const masked = groups.filter((g) => /^[.\s*]*$/.test(g.merchantCanonical));
  console.log(`\n=== O.12f: groups whose merchant name carries no information ===`);
  if (masked.length === 0) console.log('  none');
  for (const g of masked) {
    console.log(`  canonical="${g.merchantCanonical}"  rows=${g.count}  aggregate=${g.aggregate}`);
    for (const r of g.rows.slice(0, 6)) {
      console.log(
        `      ${r.date}  ${String(r.amountCents).padStart(8)}c  status=${r.status}  raw="${r.rawDescriptor}"`,
      );
    }
  }
}

void main();
