/**
 * READ-ONLY production probe — O.18c critic F2: the declared-rhythm panel
 * sentence claims "You marked this as recurring income", but a BILL override
 * stored BEFORE the `declaredSign` column existed parses to `declaredSign:
 * null` (override.ts:141) and `declaredSeries` falls back to the MAJORITY sign
 * of the merchant's charges (detect.ts:381) — a direction the reader never
 * stated. Measure, on the live corpus, whether any BILL override carries a
 * null declaredSign, and for each, which way the majority fallback would point
 * it (the direction the panel sentence would claim).
 *
 * Verdict rule: if ZERO legacy BILL rows exist, F2 is unreachable on the live
 * corpus and stays latent (this probe is the re-measurement instrument). If
 * any exists, the fix is warranted: the sentence claims a stated direction
 * where none was recorded. Every statement is a SELECT; nothing is written.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

// 1. Every BILL override, split by whether the direction was recorded.
const { rows } = await c.query(
  `SELECT "userId", "merchantCanonical", "declaredSign", "createdAt"
     FROM "RecurringOverride"
    WHERE "decision" = 'BILL'`,
);
const legacy = rows.filter((r) => r.declaredSign === null);
console.log(`BILL overrides total: ${rows.length} — recorded direction: ${rows.length - legacy.length}, legacy (null): ${legacy.length}`);

// 2. For each legacy row: which way would the majority fallback point it?
// The fallback is the dominant SIGN of the merchant's POSTED txns for that
// user (dominantSignTxns, detect.ts). The panel sentence would claim that
// direction as "marked" — false whenever the majority disagrees with the bill
// the reader actually declared.
for (const r of legacy) {
  const t = await c.query(
    `SELECT t."amountCents"
       FROM "Transaction" t
      WHERE t."userId" = $1
        AND t."status" = 'POSTED'
        AND t."merchantId" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "Merchant" m
           WHERE m.id = t."merchantId"
             AND m."canonicalName" = $2
        )`,
    [r.userId, r.merchantCanonical],
  );
  const neg = t.rows.filter((x) => x.amountCents < 0).length;
  const pos = t.rows.filter((x) => x.amountCents > 0).length;
  const fallback = pos > neg ? 'IN (income — sentence would claim "recurring income")' : 'OUT (expense — sentence reads "a bill")';
  console.log(
    `legacy BILL "${r.merchantCanonical}" (user ${r.userId}, created ${r.createdAt?.toISOString?.() ?? r.createdAt}): ` +
      `${neg} outflow / ${pos} inflow → majority fallback ${fallback}`,
  );
}

await c.end();
const verdict = legacy.length === 0 ? 'UNREACHABLE on the live corpus — F2 stays latent (probe = instrument)' : `REACHABLE — ${legacy.length} legacy row(s): the direction claim must be fixed`;
console.log(`\nVERDICT: ${verdict}`);
process.exit(legacy.length === 0 ? 0 : 1);
