/**
 * Plaid sandbox end-to-end validation (docs/PLAID_WALKTHROUGH.md §5).
 *
 * Drives the REAL PlaidProvider against Plaid's sandbox, headlessly, via
 * /sandbox/public_token/create (no interactive Link UI): create a public token
 * → exchange (stores an encrypted PlaidItem + syncs accounts) → /transactions/
 * sync → /liabilities/get → read the DB back and assert. Cleans up after itself
 * (removes the Plaid item and the temp test user via cascade).
 *
 * Requires real sandbox credentials in .env.local — never committed:
 *   PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV=sandbox, DATA_ENCRYPTION_KEY
 *
 * Run:  npm run plaid:validate
 *
 * It writes to the local dev.db under a dedicated test user id, so it does not
 * touch the demo user's data; the temp user is deleted at the end.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { prisma } from '../src/lib/db';
import { PlaidProvider } from '../src/lib/providers/plaid';

const TEST_USER_ID = 'plaid-sandbox-validate-user';
const PLAID_HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

function requireEnv(): { clientId: string; secret: string; host: string } {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const key = process.env.DATA_ENCRYPTION_KEY;
  const missing = [
    !clientId && 'PLAID_CLIENT_ID',
    !secret && 'PLAID_SECRET',
    !key && 'DATA_ENCRYPTION_KEY',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`\n❌ Missing env: ${missing.join(', ')}.`);
    console.error('   Add them to .env.local (see docs/PLAID_WALKTHROUGH.md §1) and re-run.\n');
    process.exit(2);
  }
  return { clientId: clientId!, secret: secret!, host: PLAID_HOSTS[process.env.PLAID_ENV ?? 'sandbox'] };
}

async function plaidPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { clientId, secret, host } = requireEnv();
  const res = await fetch(`${host}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, secret, ...body }),
  });
  if (!res.ok) throw new Error(`Plaid ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  requireEnv();
  console.log('▶ Plaid sandbox validation starting…\n');

  // Clean slate for the temp user.
  await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
  await prisma.user.create({ data: { id: TEST_USER_ID, email: `${TEST_USER_ID}@example.test` } });

  const provider = new PlaidProvider();
  let itemId = '';
  try {
    // 1. sandbox public token → exchange (stores PlaidItem + syncs accounts)
    const pub = await plaidPost<{ public_token: string }>('/sandbox/public_token/create', {
      institution_id: 'ins_109508', // First Platypus Bank (sandbox)
      initial_products: ['transactions'],
      options: { transactions: { days_requested: 90 } },
    });
    console.log('✓ /sandbox/public_token/create');
    await provider.exchangePublicToken(TEST_USER_ID, pub.public_token);
    const item = await prisma.plaidItem.findFirst({ where: { userId: TEST_USER_ID } });
    itemId = item?.itemId ?? '';
    console.log(`✓ exchange + token stored (encrypted, len=${item?.accessToken.length ?? 0}); item=${itemId}`);

    const accounts = await prisma.account.findMany({ where: { userId: TEST_USER_ID } });
    console.log(`✓ accounts synced: ${accounts.length}`);
    for (const a of accounts) {
      console.log(`    - ${a.type.padEnd(10)} ${a.name} ····${a.mask ?? '?'}  bal=${a.currentBalanceCents}c`);
    }

    // 2. transactions/sync — sandbox can need a moment to generate; retry a few times
    let result = { added: 0, modified: 0, removed: 0, nextCursor: null as string | null };
    for (let attempt = 1; attempt <= 6; attempt++) {
      result = await provider.syncTransactions(TEST_USER_ID);
      if (result.added > 0) break;
      console.log(`  …sync attempt ${attempt}: ${result.added} added — waiting for sandbox`);
      await sleep(2000);
    }
    console.log(`✓ /transactions/sync: added=${result.added} modified=${result.modified} removed=${result.removed}`);

    const txns = await prisma.transaction.findMany({
      where: { account: { userId: TEST_USER_ID } },
      orderBy: { date: 'desc' },
      take: 6,
    });
    const outflows = txns.filter((t) => t.amountCents < 0).length;
    const inflows = txns.filter((t) => t.amountCents > 0).length;
    console.log(`    sample (newest ${txns.length}): ${outflows} outflow(-) / ${inflows} inflow(+)`);
    for (const t of txns) {
      console.log(`    - ${t.date}  ${String(t.amountCents).padStart(8)}c  ${t.categoryId ?? '?'}  ${t.rawDescriptor.slice(0, 40)}`);
    }

    // 3. liabilities → statements (best-effort: sandbox item may lack credit accounts)
    try {
      await provider.syncLiabilities(TEST_USER_ID);
      const statements = await prisma.statement.count({ where: { account: { userId: TEST_USER_ID } } });
      console.log(`✓ /liabilities/get → statements: ${statements}`);
    } catch (e) {
      console.log(`• liabilities skipped: ${e instanceof Error ? e.message : e}`);
    }

    // Assertions
    const total = await prisma.transaction.count({ where: { account: { userId: TEST_USER_ID } } });
    const problems: string[] = [];
    if (accounts.length === 0) problems.push('no accounts were synced');
    if (total === 0) problems.push('no transactions were ingested');
    if (total > 0) {
      const anyOut = await prisma.transaction.count({ where: { account: { userId: TEST_USER_ID }, amountCents: { lt: 0 } } });
      if (anyOut === 0) problems.push('no outflows (negative amounts) — sign flip suspect');
    }

    console.log('');
    if (problems.length) {
      console.log('❌ VALIDATION FAILED:');
      for (const p of problems) console.log(`   - ${p}`);
      process.exitCode = 1;
    } else {
      console.log(`✅ VALIDATION PASSED — ${accounts.length} accounts, ${total} transactions ingested with correct signs.`);
    }
  } finally {
    // Cleanup: revoke the item at Plaid, then cascade-delete the temp user.
    try {
      if (itemId) await provider.removeItem(TEST_USER_ID, itemId);
    } catch (e) {
      console.log(`(cleanup) item remove: ${e instanceof Error ? e.message : e}`);
    }
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    console.log('▶ cleaned up temp user + item.');
  }
}

main().finally(() => process.exit(process.exitCode ?? 0));
