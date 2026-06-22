/**
 * SimpleFIN LIVE-PATH validation against the public demo server (DECISIONS #56
 * follow-up). Runs the app's REAL functions — claimAccessUrl → fetchSimplefinAccounts
 * → mapSimplefinAccount/prepareSimplefinTransaction — end to end, so the network
 * path that was previously UNVERIFIED is exercised for real. Demo data only; no
 * bank, no secret. Usage: tsx scripts/simplefin-validate.ts <setupToken>
 */
import { claimAccessUrl, fetchSimplefinAccounts } from '@/lib/providers/simplefin';
import { mapSimplefinAccount, prepareSimplefinTransaction } from '@/lib/providers/simplefin-map';
import { categoryName } from '@/lib/engine/categorize/categories';
import { isoDate } from '@/lib/dates';

const token = process.argv[2] ?? process.env.SIMPLEFIN_SETUP_TOKEN;
if (!token) {
  console.error('Pass a SimpleFIN setup token: tsx scripts/simplefin-validate.ts <token>');
  process.exit(1);
}

async function main(setupToken: string) {
  console.log('1) claimAccessUrl(setupToken) — POST the claim URL …');
  const accessUrl = await claimAccessUrl(setupToken);
  console.log('   ✓ got access URL:', accessUrl.replace(/\/\/[^@]+@/, '//***:***@'));

  console.log('2) fetchSimplefinAccounts(accessUrl) — GET /accounts …');
  const data = await fetchSimplefinAccounts(accessUrl);
  console.log(`   ✓ ${data.accounts?.length ?? 0} account(s); server errors: ${JSON.stringify(data.errors ?? [])}`);

  const today = isoDate('2026-06-22');
  for (const acct of data.accounts ?? []) {
    const m = mapSimplefinAccount(acct);
    console.log(`\n   ACCOUNT "${acct.name}" (balance "${acct.balance}")`);
    console.log(`     → Pulse: type=${m.type}  balanceCents=${m.currentBalanceCents}  name="${m.name}"`);
    const txns = acct.transactions ?? [];
    console.log(`     transactions: ${txns.length}`);
    for (const t of txns.slice(0, 3)) {
      const row = prepareSimplefinTransaction(t, m.providerRef, today, []);
      console.log(
        `       "${(t.description ?? '').slice(0, 28).padEnd(28)}" amount="${t.amount}" → ` +
          `${row.amountCents} cents  ${row.date}  [${categoryName(row.categoryId)}]`,
      );
    }
  }
  console.log('\n✓ SimpleFIN live path exercised end-to-end (claim + fetch + map) against the demo server.');
}

main(token).catch((e) => {
  console.error('✗ FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
