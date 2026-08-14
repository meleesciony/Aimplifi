/**
 * U.9 — exhaustive property probe for the supersession-COMPONENT snapshot rule.
 *
 * The fix's claim is an invariant, not a behaviour: after
 * `applyReconciliationBoundary`, exactly ONE balance snapshot survives per
 * (supersession component, date) whenever that component had any row on that
 * date. Both failure directions are money bugs and they point opposite ways:
 *   - more than one survivor  → the U.9 double-count ($5,000.00 read as $10,000.00);
 *   - zero survivors          → a silently deleted balance and a fabricated dip.
 * A third failure is nondeterminism: if the winner depends on input order, the
 * figure is not reproducible and no test of it means anything.
 *
 * So this enumerates every link shape over 4 accounts (out-degree <= 1, mirroring
 * the `predecessorAccountId @unique` constraint, across 2 candidate cutovers) and,
 * for each, every subset of (account, date) snapshot presence over 2 dates —
 * chains, siblings, sibling-of-a-chain-member, cycles, non-monotone races, and
 * every degenerate shape in between, including the ones the confirm action
 * refuses at write time but a racing commit can still produce.
 *
 * Grouping is UNION-FIND over the undirected effective edges, deliberately not a
 * terminal walk. The first draft of this probe walked to the terminal exactly as
 * `remapToTerminal` does, and a critic pointed out that this is a line-for-line
 * reimplementation of the thing under test: if the engine's component key were
 * wrong, the probe would group by the same wrong key and report success. Union-find
 * shares no logic with the engine, so a component the engine splits (or merges)
 * incorrectly shows up here as a violation.
 *
 * Read-only. Writes nothing, reads no database.
 *
 *   npx tsx scripts/audit-probes/u9-component-invariant.mts
 */
import {
  applyReconciliationBoundary,
  effectiveReconciliationLinks,
  type ReconciliationLinkLike,
} from '../../src/lib/engine/account/reconcile-boundary';

const IDS = ['a', 'b', 'c', 'd'] as const;
const ACCOUNTS = IDS.map((id) => ({ id, type: 'CHECKING', currentBalanceCents: 100_000, feedDroppedAt: null }));
const DATES = ['2026-02-28', '2026-05-31'] as const;
const CUTOVERS = ['2026-02-28', '2026-05-31'] as const;

type Row = { accountId: string; date: string; balanceCents: number };

/** Every succ-function over IDS with out-degree <= 1, each edge at each cutover. */
function allLinkShapes(): ReconciliationLinkLike[][] {
  const perAccount = IDS.map((p) => {
    const opts: (ReconciliationLinkLike | null)[] = [null];
    for (const s of IDS) {
      if (s === p) continue;
      for (const c of CUTOVERS) {
        opts.push({ predecessorAccountId: p, successorAccountId: s, cutoverDate: c });
      }
    }
    return opts;
  });
  const out: ReconciliationLinkLike[][] = [];
  const walk = (i: number, acc: ReconciliationLinkLike[]): void => {
    if (i === perAccount.length) {
      out.push(acc);
      return;
    }
    for (const o of perAccount[i] as (ReconciliationLinkLike | null)[]) {
      walk(i + 1, o === null ? acc : [...acc, o]);
    }
  };
  walk(0, []);
  return out;
}

/**
 * Connected components by UNION-FIND over the UNDIRECTED effective edges — no
 * direction, no terminal, nothing borrowed from the engine. Two accounts share a
 * key iff a chain of links relates them at all, which is exactly the "same real
 * account" equivalence the boundary claims to de-duplicate over.
 */
function componentKeys(links: readonly ReconciliationLinkLike[]): (id: string) => string {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = parent.get(x) ?? x;
    if (r === x) return x;
    r = find(r);
    parent.set(x, r);
    return r;
  };
  const union = (x: string, y: string): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };
  for (const l of links) union(l.predecessorAccountId, l.successorAccountId);
  return find;
}

const CELLS = IDS.length * DATES.length;

let shapesWithEffectiveLinks = 0;
let casesChecked = 0;
let multiSurvivor = 0;
let zeroSurvivor = 0;
let orderDependent = 0;
const examples: string[] = [];
const note = (s: string): void => {
  if (examples.length < 6) examples.push(s);
};

for (const links of allLinkShapes()) {
  const effective = effectiveReconciliationLinks(ACCOUNTS, links);
  if (effective.length === 0) continue; // R8 fast path — input returned by reference
  shapesWithEffectiveLinks++;
  const componentOf = componentKeys(effective);

  for (let mask = 1; mask < 1 << CELLS; mask++) {
    const rows: Row[] = [];
    for (let bit = 0; bit < CELLS; bit++) {
      if ((mask & (1 << bit)) === 0) continue;
      rows.push({
        accountId: IDS[Math.floor(bit / DATES.length)] as string,
        date: DATES[bit % DATES.length] as string,
        balanceCents: 100_000,
      });
    }

    const run = (input: Row[]): Row[] =>
      applyReconciliationBoundary({
        paymentAccountId: null,
        accounts: ACCOUNTS,
        transactions: [],
        balanceSnapshots: input,
        statements: [],
        scheduled: [],
        links,
      }).balanceSnapshots as Row[];

    const forward = run(rows);
    const reversed = run([...rows].reverse());
    casesChecked++;

    const sig = (rs: Row[]): string =>
      rs
        .map((r) => `${r.accountId}:${r.date}`)
        .sort()
        .join(',');
    if (sig(forward) !== sig(reversed)) {
      orderDependent++;
      note(`ORDER-DEPENDENT links=${JSON.stringify(links)} fwd=${sig(forward)} rev=${sig(reversed)}`);
    }

    const groupKey = (r: Row): string => `${componentOf(r.accountId)}|${r.date}`;
    const present = new Set(rows.map(groupKey));
    const kept = new Map<string, number>();
    for (const r of forward) kept.set(groupKey(r), (kept.get(groupKey(r)) ?? 0) + 1);

    for (const key of present) {
      const n = kept.get(key) ?? 0;
      if (n > 1) {
        multiSurvivor++;
        note(`MULTI(${n}) ${key} links=${JSON.stringify(links)} rows=${sig(rows)}`);
      } else if (n === 0) {
        zeroSurvivor++;
        note(`ZERO ${key} links=${JSON.stringify(links)} rows=${sig(rows)}`);
      }
    }
  }
}

console.log(
  JSON.stringify(
    { shapesWithEffectiveLinks, casesChecked, multiSurvivor, zeroSurvivor, orderDependent },
    null,
    2,
  ),
);
for (const e of examples) console.log(e);
console.log(
  multiSurvivor === 0 && zeroSurvivor === 0 && orderDependent === 0
    ? 'INVARIANT HOLDS across every enumerated shape'
    : 'INVARIANT VIOLATED — see examples above',
);
