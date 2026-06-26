/**
 * scripts/plaid-prod-check.ts — SAFE production-credential check.
 *
 * Confirms PLAID_CLIENT_ID + PLAID_SECRET authenticate against the chosen Plaid
 * host by creating ONE link_token via /link/token/create. A link token creates
 * NO Item, links NO bank, stores NOTHING locally, and is not billed per-Item — so
 * this is the lowest-risk way to verify a *production* secret is live, short of the
 * deploy-time real-bank smoke test (docs/PLAID_WALKTHROUGH.md).
 *
 * Reuses the app's OWN link-token body (`linkTokenParams`, unit-tested in
 * plaid-oauth.test.ts) and error formatter (`plaidErrorSummary`) so the check
 * exercises exactly what the app sends and prints only Plaid's non-secret envelope.
 *
 * SECRET HYGIENE — read before running:
 *   • Credentials are read from the PROCESS ENV only. Nothing is written to disk
 *     (this tree is OneDrive-synced) and nothing is committed.
 *   • NEVER paste the secret into source, a tracked file, or chat. Run it for ONE
 *     invocation with the secret kept out of shell history, e.g. (Git Bash):
 *
 *       read -rs PLAID_SECRET; echo; export PLAID_SECRET
 *       export PLAID_CLIENT_ID=your_client_id PLAID_ENV=production
 *       npm run plaid:prod-check
 *       unset PLAID_SECRET PLAID_CLIENT_ID
 *
 *   • Output is redacted: the link_token itself is NEVER printed.
 */
import { linkTokenParams, plaidErrorSummary } from '../src/lib/providers/plaid';

const PLAID_HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

async function main(): Promise<number> {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  // This script exists to check a PRODUCTION secret, so production is the default;
  // an explicit PLAID_ENV still wins (e.g. to re-check a sandbox key).
  const envName = process.env.PLAID_ENV ?? 'production';

  if (!clientId || !secret) {
    console.error('✋ Missing PLAID_CLIENT_ID and/or PLAID_SECRET in the environment.');
    console.error('   Nothing was sent. Set them transiently and re-run (see the header comment).');
    return 2;
  }
  const host = PLAID_HOSTS[envName];
  if (!host) {
    console.error(`✋ PLAID_ENV must be 'sandbox' or 'production' (got "${envName}"). Nothing was sent.`);
    return 2;
  }

  console.log(`→ Checking ${envName} credentials against ${host} (link/token/create — no Item created)…`);

  // The EXACT app link-token body (minus client_id/secret), with NO redirect_uri so
  // an unregistered URI can't cause a false negative on a pure credential check.
  const body = { client_id: clientId, secret, ...linkTokenParams('prod-credential-check') };

  let res: Response;
  try {
    res = await fetch(`${host}/link/token/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(`❌ Network error reaching Plaid: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const json: Record<string, unknown> = await res.json().catch(() => ({}));

  if (res.ok && typeof json.link_token === 'string') {
    console.log(`✅ ${envName} credentials are VALID — link/token/create succeeded.`);
    console.log(`   expiration: ${typeof json.expiration === 'string' ? json.expiration : '(none)'}`);
    console.log(`   request_id: ${typeof json.request_id === 'string' ? json.request_id : '(none)'}`);
    console.log('   link_token intentionally NOT printed; no Item was created, nothing stored, not billed.');
    return 0;
  }

  console.error(`❌ ${envName} credential check FAILED — HTTP ${res.status}.`);
  console.error(`   ${plaidErrorSummary(json)}`);
  if (res.status === 400 || res.status === 401) {
    console.error('   (INVALID_API_KEYS here means the client_id / secret / PLAID_ENV trio do not match.)');
  }
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    // Defensive: never surface the request body (which carries the secret).
    console.error(`❌ Unexpected error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
