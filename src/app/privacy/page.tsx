import type { Metadata } from 'next';
import Link from 'next/link';
import {
  PRIVACY_LAST_UPDATED,
  PRIVACY_POLICY,
  type PolicyBlock,
} from '@/lib/legal/privacy-policy';

/**
 * Public privacy policy (Plaid production-access requires a publicly reachable
 * URL). Top-level route → root layout only, and EXCLUDED from the auth matcher in
 * src/middleware.ts, so it renders with no session. Content is the single source
 * in src/lib/legal/privacy-policy.ts (asserted by tests/unit/privacy-policy.test.ts).
 */
export const metadata: Metadata = {
  title: 'Privacy',
  description: 'How Aimplifi stores, protects, shares, and deletes your data.',
};

function Block({ block }: { block: PolicyBlock }) {
  if (typeof block === 'string') {
    return <p className="text-sm leading-relaxed text-muted-foreground">{block}</p>;
  }
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-emerald-500">
      {block.list.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12">
      <header className="mb-8 border-b border-border pb-6">
        <Link
          href="/sign-in"
          className="text-sm font-semibold tracking-tight text-foreground hover:opacity-80"
        >
          Aim<span className="text-emerald-500">plifi</span>
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
          {PRIVACY_POLICY.title}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Last updated{' '}
          <time dateTime={PRIVACY_LAST_UPDATED} className="tabular-nums">
            {PRIVACY_LAST_UPDATED}
          </time>
        </p>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{PRIVACY_POLICY.intro}</p>
      </header>

      <div className="space-y-8">
        {PRIVACY_POLICY.sections.map((section) => (
          <section key={section.id} id={section.id} className="space-y-3 scroll-mt-6">
            <h2 className="text-base font-semibold text-foreground">{section.heading}</h2>
            {section.body.map((block, i) => (
              <Block key={i} block={block} />
            ))}
          </section>
        ))}
      </div>

      <footer className="mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
        <Link href="/sign-in" className="underline-offset-2 hover:text-foreground hover:underline">
          ← Back to sign in
        </Link>
      </footer>
    </main>
  );
}
