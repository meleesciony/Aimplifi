/**
 * The brokerages the app recognizes by NAME (DECISIONS #788).
 *
 * One table with two readings per brokerage: how a BANK DESCRIPTION names it
 * (`descriptor`) and how a CONNECTION names it (`institution`, read against an
 * account's institution name, else its feed name). The descriptor half is the
 * categorizer's own list — the `investment` rule in `categorize/normalize.ts`
 * (#163) — split per brokerage; a drift lock in
 * `tests/unit/investment-deposits.test.ts` fails when either list gains or
 * loses a name the other does not carry.
 *
 * FIDELITY stays qualified on the descriptor side for the categorizer's reason
 * (critic P1-3 on #163): "FIDELITY NATIONAL TITLE" is an escrow company. The
 * institution side reads a connection's name, where "Fidelity" alone is the
 * brokerage — or a bank called Fidelity, which only ever makes a destination
 * LESS certain (it is a bank account at "the same brokerage"), never more.
 */
export interface Brokerage {
  /** Stable key. */
  readonly key: string;
  /** The name the reader sees. */
  readonly name: string;
  /** How a bank description names it (uppercase descriptor text, case-insensitive). */
  readonly descriptor: RegExp;
  /** How a connection's institution (or feed) name names it. */
  readonly institution: RegExp;
}

export const BROKERAGES: readonly Brokerage[] = [
  { key: 'vanguard', name: 'Vanguard', descriptor: /\bVANGUARD\b/i, institution: /\bvanguard\b/i },
  { key: 'fidelity', name: 'Fidelity', descriptor: /\b(?:FIDELITY INVEST\w*|FID BKG)\b/i, institution: /\bfidelity\b/i },
  { key: 'schwab', name: 'Charles Schwab', descriptor: /\b(?:CHARLES SCHWAB|SCHWAB)\b/i, institution: /\bschwab\b/i },
  { key: 'coinbase', name: 'Coinbase', descriptor: /\bCOINBASE\b/i, institution: /\bcoinbase\b/i },
  { key: 'robinhood', name: 'Robinhood', descriptor: /\bROBINHOOD\b/i, institution: /\brobinhood\b/i },
  { key: 'etrade', name: 'E*TRADE', descriptor: /\bE\*?TRADE\b/i, institution: /\bE ?\*? ?TRADE\b/i },
  { key: 'wealthfront', name: 'Wealthfront', descriptor: /\bWEALTHFRONT\b/i, institution: /\bwealthfront\b/i },
  { key: 'betterment', name: 'Betterment', descriptor: /\bBETTERMENT\b/i, institution: /\bbetterment\b/i },
  { key: 'acorns', name: 'Acorns', descriptor: /\bACORNS\b/i, institution: /\bacorns\b/i },
  { key: 'merrill', name: 'Merrill', descriptor: /\bMERRILL\b/i, institution: /\bmerrill\b/i },
];

/** Every brokerage a bank description names (0, 1, or — ambiguous — several). */
export function brokeragesNamedIn(descriptor: string): Brokerage[] {
  return BROKERAGES.filter((b) => b.descriptor.test(descriptor));
}

/**
 * The brokerage an ACCOUNT belongs to: its connection's institution name when
 * known, else — only when no institution is known (a manual or demo account) —
 * its feed name ("Vanguard Cash Plus"). Exactly one match or none: a name that
 * reads as two brokerages names neither.
 */
export function brokerageOfAccount(institutionName: string | null, feedName: string): Brokerage | null {
  const text = institutionName?.trim() ? institutionName : feedName;
  const hits = BROKERAGES.filter((b) => b.institution.test(text));
  return hits.length === 1 ? hits[0]! : null;
}
