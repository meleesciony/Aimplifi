/**
 * scripts/simplefin-check.ts — SAFE SimpleFIN credential check (no DB writes, nothing stored).
 *
 * The SimpleFIN analog of scripts/plaid-prod-check.ts. Confirms a SimpleFIN
 * credential can authenticate and list your accounts, then stops. Reuses the app's
 * OWN hardened functions — claimAccessUrl + fetchSimplefinAccounts (SSRF-guarded
 * safeFetch: every redirect re-validated, Authorization dropped on a cross-host
 * hop) and mapSimplefinAccount (the inferred account type) — so it behaves exactly
 * like the app's connect path, minus the persistence.
 *
 * Distinct from scripts/simplefin-validate.ts, which is a verbose DEMO-server
 * harness that takes the token as a CLI arg (→ shell history) and dumps
 * transactions. This one is for a REAL credential: hidden input via the .ps1
 * wrapper / env, minimal data, and it surfaces the access URL so a consumed setup
 * token isn't lost.
 *
 * Credential is read from env (first match wins):
 *   SIMPLEFIN_ACCESS_URL  — PREFERRED, non-destructive + repeatable (lists accounts).
 *   SIMPLEFIN_SETUP_TOKEN — claims it (⚠ ONE-TIME: claiming CONSUMES the token),
 *                           prints the resulting access URL to SAVE, then lists.
 *   SIMPLEFIN_CREDENTIAL  — auto-detected: an https:// value is an access URL,
 *                           anything else a setup token. (The .ps1 sets this.)
 *
 * SECRET HYGIENE: the access URL carries embedded read-only credentials — never
 * paste it into chat or commit it. It is printed only when a setup token was just
 * claimed (you need it then). Nothing is written to disk or the database.
 */
import { claimAccessUrl, fetchSimplefinAccounts } from '../src/lib/providers/simplefin';
import { mapSimplefinAccount } from '../src/lib/providers/simplefin-map';

function resolveCredential(): { value: string; mode: 'access' | 'token' } | null {
  const accessUrl = process.env.SIMPLEFIN_ACCESS_URL?.trim();
  if (accessUrl) return { value: accessUrl, mode: 'access' };
  const token = process.env.SIMPLEFIN_SETUP_TOKEN?.trim();
  if (token) return { value: token, mode: 'token' };
  const cred = process.env.SIMPLEFIN_CREDENTIAL?.trim();
  if (cred) return { value: cred, mode: cred.startsWith('https://') ? 'access' : 'token' };
  return null;
}

function printAccessUrlNotice(accessUrl: string): void {
  console.log('');
  console.log('⚠ SAVE THIS — your setup token is now spent and cannot be re-claimed.');
  console.log('  This access URL carries read-only credentials. Store it in Vercel as');
  console.log('  SIMPLEFIN_ACCESS_URL (or connect it through the app). Do NOT paste it');
  console.log('  into chat or commit it:');
  console.log('');
  console.log(`    ${accessUrl}`);
  console.log('');
}

async function main(): Promise<number> {
  const cred = resolveCredential();
  if (!cred) {
    console.error('✋ No credential found. Set SIMPLEFIN_ACCESS_URL (preferred), SIMPLEFIN_SETUP_TOKEN,');
    console.error('   or SIMPLEFIN_CREDENTIAL in the environment. Nothing was sent.');
    return 2;
  }

  let accessUrl: string;
  let claimed = false;
  if (cred.mode === 'access') {
    accessUrl = cred.value;
    console.log('→ Using a SimpleFIN access URL (non-destructive)…');
  } else {
    console.log('→ Claiming the setup token — ONE-TIME, this CONSUMES it…');
    try {
      accessUrl = await claimAccessUrl(cred.value);
      claimed = true;
    } catch (e) {
      console.error(`❌ Claim failed: ${e instanceof Error ? e.message : String(e)}`);
      console.error('   The setup token may be invalid, already claimed, or expired — generate a fresh one.');
      return 1;
    }
  }

  console.log('→ Fetching the account list (balances only — no transaction history pulled)…');
  try {
    const data = await fetchSimplefinAccounts(accessUrl); // no start-date → accounts/balances, minimal
    const accounts = data.accounts ?? [];
    const errors = data.errors ?? [];

    if (errors.length > 0) {
      console.error(`⚠ SimpleFIN reported ${errors.length} error(s):`);
      for (const msg of errors) console.error(`   - ${msg}`);
    }

    console.log(`✅ SimpleFIN credentials are VALID — fetched ${accounts.length} account(s).`);
    for (const a of accounts) {
      const org = a.org?.name || a.org?.domain || '—';
      console.log(`   • ${org}: ${a.name}  →  ${mapSimplefinAccount(a).type}`);
    }
    if (accounts.length === 0) {
      console.log('   (Authenticated, but no accounts came back — confirm the SimpleFIN Bridge has banks linked.)');
    }

    if (claimed) printAccessUrlNotice(accessUrl);
    return errors.length > 0 && accounts.length === 0 ? 1 : 0;
  } catch (e) {
    console.error(`❌ SimpleFIN credential check FAILED: ${e instanceof Error ? e.message : String(e)}`);
    if (claimed) printAccessUrlNotice(accessUrl); // don't let a just-claimed URL be lost
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`❌ Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
