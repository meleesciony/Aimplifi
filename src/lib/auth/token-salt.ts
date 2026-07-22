/**
 * The one at-rest hashing salt idiom (2026-07-21 agent review, finding B3).
 *
 * Three secrets are stored only as `sha256(salt:value)` — the password-reset
 * token (#257), the household invite code (#210), and the deletion record's user
 * ref (#150) — and each had hand-rolled the SAME three-tier resolution, the third
 * of them describing itself as "the deletionRefSalt idiom" in a comment. An idiom
 * copied by comment is an idiom that drifts, so it lives here as code.
 *
 * Resolution order, unchanged from all three copies:
 *   1. the feature's own env var — lets one salt rotate without touching the others;
 *   2. AUTH_SECRET — always present in a real deployment (NextAuth requires it),
 *      so a deployed install is salted with a secret even if step 1 is unset;
 *   3. a PUBLIC per-feature dev default — demo mode must boot with ZERO env vars
 *      (CLAUDE.md rule 4). With this default the hashes are pseudonymous, not
 *      secret; that is acceptable only because no deployment reaches step 3.
 *
 * `??` (not `||`) is deliberate and matches the originals: an explicitly-set
 * EMPTY salt is honoured rather than silently falling through to the next tier —
 * a value the operator set is a value the operator meant.
 *
 * NOTE: the salts are per-feature by design. Rotating one (or changing its dev
 * default) invalidates every hash already stored for that feature — outstanding
 * reset links and invite codes stop matching. That is the intended blast radius
 * for a rotation, and the reason these strings are never edited casually.
 */
export function tokenSalt(envVarName: string, devFallback: string): string {
  return process.env[envVarName] ?? process.env.AUTH_SECRET ?? devFallback;
}
