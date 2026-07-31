/**
 * Public privacy policy — the SINGLE SOURCE rendered by /privacy (src/app/privacy/
 * page.tsx) and asserted by tests/unit/privacy-policy.test.ts. Every guarantee
 * stated here is enforced in code; the cited module is the proof:
 *
 *   - "mask (last 4 only), never full numbers"  -> prisma/schema.prisma (Account.mask)
 *   - "access tokens AES-256-GCM encrypted"     -> src/lib/crypto.ts
 *   - "delete -> revoke at Plaid -> cascade"    -> src/server/account-actions.ts,
 *                                                  src/lib/providers/plaid.ts (removeItem)
 *   - "every query scoped by userId"            -> src/server/authz.ts
 *   - "security headers / CSP"                  -> next.config.ts
 *   - "AI sends only descriptor+amount / question, only with a key" ->
 *                                                  src/server/llm-categorize.ts,
 *                                                  src/server/assistant-llm.ts
 *   - "pasted statement text sent only on explicit use, digit runs removed" ->
 *                                                  src/server/llm-statement-extract.ts,
 *                                                  scrubAccountNumbers (engine/doc-extract)
 *
 * Keep in sync with docs/PRIVACY.md (engineering note) and
 * docs/DATA_RETENTION_AND_DISPOSAL.md (the Plaid compliance deliverable).
 */

/** ISO date (YYYY-MM-DD) this policy was last reviewed. */
export const PRIVACY_LAST_UPDATED = '2026-07-31';

/** Contact for privacy questions and deletion requests. */
export const PRIVACY_CONTACT_EMAIL = 'michael.lee.p@gmail.com';

/** A block within a section: either a paragraph (string) or a bullet list. */
export type PolicyBlock = string | { readonly list: readonly string[] };

export interface PolicySection {
  readonly id: string;
  readonly heading: string;
  readonly body: readonly PolicyBlock[];
}

export interface PrivacyPolicy {
  readonly title: string;
  readonly intro: string;
  readonly sections: readonly PolicySection[];
}

export const PRIVACY_POLICY: PrivacyPolicy = {
  title: 'Privacy Policy',
  intro:
    'Aimplifi is a personal-finance app that helps you see exactly how much money you ' +
    'need, and by when, to pay every card in full. This policy explains what the app ' +
    'stores, what it never stores, who it shares data with, and how you can export or ' +
    'permanently delete everything. It is written to be GDPR/CCPA-minded. In demo mode ' +
    'the app runs entirely on a seeded, fictional dataset — no real financial data is ' +
    'involved until you create an account and connect a bank.',
  sections: [
    {
      id: 'what-we-store',
      heading: 'What we store',
      body: [
        'When you connect a financial institution, the app stores only the data its features need:',
        {
          list: [
            'Account metadata: institution name, account name, account type, and the mask — the last 4 digits only. Full account numbers are never requested, stored, or displayed.',
            'Transactions, statements, balances, and scheduled/recurring items — the data the cash-needed, budgeting, and forecasting engines run on.',
            'Provider access tokens (Plaid or SimpleFIN), AES-256-GCM encrypted at rest. Tokens are never logged and never sent to your browser.',
            'Your settings: email, a salted password hash (for email sign-in), and your planning assumptions (wage, return and withdrawal rates, money dials).',
            'Receipts and documents you attach to a transaction: the file itself, its name, its size, and the file type we determine by reading the bytes. Only you can open them — a household partner you share an account with sees that account’s transactions, never the files attached to them — and they are never sent to a third party.',
            'An audit log of sensitive actions — sign-in, data exports, goal/budget/rule changes, sync runs, bank link/unlink, operator-run data repairs (counts only), and account deletion — so account activity is accountable.',
          ],
        },
        'All money is stored as integer cents, and all balances are stored as positive numbers; the account type determines whether a balance counts as an asset or a liability.',
      ],
    },
    {
      id: 'what-we-never-store',
      heading: 'What we never collect or store',
      body: [
        'Some data simply never enters the system:',
        {
          list: [
            'Your bank username or password. Credentials go directly to Plaid Link (or SimpleFIN) and never touch our servers.',
            'Full card or account numbers are never requested from your bank, derived from your accounts, or displayed — only the last-4 mask is kept. (A file you upload yourself is stored exactly as you supplied it: we read its first few bytes to identify the file type and never inspect, index, or redact its contents.)',
            'Social Security numbers or other government identifiers.',
            'Plaid public tokens — these are exchanged for an encrypted access token immediately and discarded.',
          ],
        },
      ],
    },
    {
      id: 'how-we-protect',
      heading: 'How your data is protected',
      body: [
        {
          list: [
            'Encryption at rest: provider access tokens (and the SimpleFIN access URL, which carries credentials) are AES-256-GCM encrypted with a key held only in the server environment.',
            'Encryption in transit: when deployed (e.g., on Vercel), all traffic is served over HTTPS/TLS.',
            'Access control: the app sits behind session middleware, and every server action re-verifies your session and scopes every database query to your own user id — you can only ever read or change your own data.',
            'Hardened headers: a strict Content-Security-Policy (no third-party analytics or advertising scripts), X-Frame-Options DENY, nosniff, and a strict referrer policy.',
            'Rate limiting on authentication and data-export endpoints to blunt abuse.',
            'Secrets (encryption key, provider credentials) are supplied only through environment variables, never committed to the codebase.',
          ],
        },
      ],
    },
    {
      id: 'third-parties',
      heading: 'Who we share data with',
      body: [
        'We do not sell your data, and the app shows no ads and loads no third-party tracking scripts. Data is shared only with the service providers that make features work:',
        {
          list: [
            'Plaid or SimpleFIN — to securely connect your accounts and retrieve balances, transactions, and liabilities. You authorize the connection yourself, and you can revoke it at any time.',
            'Optional AI features (off unless an AI key is configured): to label an unrecognized transaction, only that transaction’s descriptor and amount are sent to the configured model provider — never your name, email, account numbers, or balances. For typed questions, only your question text is sent, to route it to a feature. If you choose to use the statement extractor, the statement text you explicitly paste is sent to the same provider after recognizable long digit runs (like card and account numbers) are removed — removal is best-effort and can miss unusual formats — that pasted text can include balances and whatever else you paste, so paste only the statement’s summary section; this never happens automatically. With no AI key, nothing leaves the app and a deterministic fallback is used instead.',
            'Hosting (e.g., Vercel) — the infrastructure the app runs on.',
          ],
        },
      ],
    },
    {
      id: 'retention',
      heading: 'How long we keep it',
      body: [
        'Your data is kept only while your account exists. There is no resale and no fixed expiry timer: data persists so the product works, and is removed when you delete your account. Deleting your account erases everything and revokes any linked bank access token at the provider (see below). In demo mode the sample dataset can be recreated at any time by reseeding.',
      ],
    },
    {
      id: 'your-rights',
      heading: 'Your rights — export and deletion',
      body: [
        'Your data is yours. From Settings you can:',
        {
          list: [
            'Export your transactions (CSV) and net worth (CSV or PDF) at any time.',
            'Permanently delete everything via Settings → “Delete my data”. The destructive action is gated behind a typed confirmation and shows exactly what will be removed.',
          ],
        },
        'Deletion runs in three steps: (1) you confirm by typing the exact phrase; (2) any linked Plaid item has its access token revoked at Plaid; (3) your user record is deleted, which cascades to every related row — accounts, transactions, statements, payments, scheduled items, balance snapshots, rules, corrections, recurring series, goals, budgets, linked items, attached receipts and documents and the files themselves, and the audit log itself. Nothing about you is retained, and the action is irreversible.',
      ],
    },
    {
      id: 'contact',
      heading: 'Contact and changes',
      body: [
        `Questions about this policy, or a request related to your data, can be sent to ${PRIVACY_CONTACT_EMAIL}.`,
        'This policy is reviewed whenever the app’s data handling changes, and at least annually. The “last updated” date at the top of this page reflects the most recent review.',
      ],
    },
  ],
};
