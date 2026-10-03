/**
 * Same-account comparison — "did I spend more in May than in March?" answered only on
 * the accounts whose records are known to be whole for BOTH periods, with every other
 * account named beside the figure.
 *
 * Why it is built this way. An earlier attempt at this question (unshipped) tried to
 * decide, from the pattern of rows alone, whether an account that goes quiet was closed
 * (its silence is real, count it as $0) or lost its feed (its silence is a hole, the
 * comparison is unsafe). That is not decidable from rows: a closed card and a broken
 * connection look identical. Eight review cycles each found another household the
 * guess got wrong, silently, in dollars.
 *
 * This engine does not guess. It uses three kinds of FACT and nothing else:
 *
 *   1. Rows. An account with a row on or before a period's first day was already on
 *      record when the period began; one with a row on or after its last day was still
 *      on record when it ended.
 *   2. The feed. A live connection that last succeeded after a period ended has
 *      delivered that period; no rows since means nothing happened.
 *   3. The reader's own word, asked once: "did you stop using this card after its last
 *      transaction?" / "is its first transaction when you opened it?". Kept against the
 *      date it was given for, so a later row past that date quietly voids it.
 *
 * An account that is whole on both sides is IN. Any other account that has ever spent
 * is LEFT OUT of both sides — never priced at $0 — and returned with what it does have
 * on record, why it was left out, and the one question that would let it in.
 *
 * What the figure therefore claims is narrow and true: "on these accounts, this period
 * against that one". The one assumption it rests on, which the caller prints: an
 * account's record has no holes BETWEEN its first and last transaction.
 *
 * What counts as spending, and how it nets, is NOT decided here. The caller passes a
 * `figure` function — in the app, the same `spendingByCategory` every other surface
 * prints — and this module only decides WHICH accounts' rows it is given. So a month
 * in a comparison is the number Ask already gives for that month, whenever every
 * account is in.
 *
 * Pure: no I/O, no clock (the caller passes `today`), integer cents, calendar dates.
 */
import { addDays, compareDates, type ISODate } from '@/lib/dates';

/** An inclusive span of calendar dates. */
export interface Period {
  start: ISODate;
  end: ISODate;
}

/** A spending figure for one set of rows over one period, as the caller computes it. */
export interface Figure {
  totalCents: number;
  /** What the total is made of. Must sum to `totalCents`. */
  groups: readonly { key: string; label: string; cents: number }[];
}

/** The reader's answer about one edge of an account's record, and the edge date it was given for. */
export interface EdgeWord {
  forDate: ISODate;
  /** `real`: the record starts/ends there because the account did. `missing`: there is more, not on record. */
  verdict: 'real' | 'missing';
}

/** What is known about one account's record — facts only, gathered by the caller. */
export interface AccountRecord {
  id: string;
  name: string;
  /**
   * Accounts that are ONE account to the reader share a lineage: a card and the
   * connection that replaced it, joined by a reconciliation the reader confirmed.
   * An account on its own is its own lineage (use its id).
   */
  lineageId: string;
  /** First and last date of ANY row on record (spending or not). Null when there are none. */
  firstRowDate: ISODate | null;
  lastRowDate: ISODate | null;
  /**
   * Date ranges (inclusive) in which this account's rows are NOT kept — the reconciliation
   * boundary's own drops for a combined account (`reconciliationDroppedRanges`). Its record
   * covers its first-to-last-row span minus these, and nothing proves a dropped day empty.
   */
  dropped?: readonly { from: ISODate; to: ISODate }[];
  /**
   * The record is known complete through this date because a live feed succeeded
   * after it. Null when no feed says so (manual, imported, disconnected).
   */
  completeThrough: ISODate | null;
  /** `live`: connected, last sync succeeded. `failing`: connected, last sync failed. `none`: no connection. */
  feed: 'live' | 'failing' | 'none';
  startWord: EdgeWord | null;
  endWord: EdgeWord | null;
  /** Whether this account has ever had a spending row of any kind. One that never has is not part of the question. */
  everSpent: boolean;
  /**
   * Kept by hand — typed in or imported from files, never fed by a connection. Nothing
   * vouches for what lies between such an account's first and last row, so the caller
   * says so beside any figure it is part of.
   */
  handKept: boolean;
}

/** Why an account was left out of both sides. */
export type LeftOutReason =
  /** Its record begins after a period began, and nothing says that is when the account began. */
  | { edge: 'start'; date: ISODate; told: boolean }
  /** Its record stops before a period ended. `through` is the last date it is known complete for. */
  | { edge: 'end'; through: ISODate; feed: 'live' | 'failing' | 'none'; told: boolean }
  /**
   * One account to the reader, carried on two records (a card and the connection that
   * replaced it) — and `from`…`to` is on NEITHER of them. `before` names the record that
   * stops, `after` the one that starts.
   */
  | {
      edge: 'gap';
      from: ISODate;
      to: ISODate;
      before: string;
      after: string;
      told: boolean;
      /** The boundary's drops made it (a reader's cutover): no answer can settle it. */
      dropped: boolean;
    }
  /** It has spent, but no row of it is on record up to today (only future-dated rows). */
  | { edge: 'empty'; told: false };

/** The one question that would settle an edge. Absent when a question cannot settle it (a failing feed). */
export interface AccountQuestion {
  accountId: string;
  accountName: string;
  edge: 'start' | 'end';
  /** The edge date the answer will be kept against. */
  date: ISODate;
}

/**
 * One account (lineage) and its own figure for each side — what the app would say was
 * spent on that account alone. Under a `figure` that nets within groups these need not
 * add up to the comparison's sides; they are there to be shown, not summed.
 */
export interface AccountSide {
  lineageId: string;
  name: string;
  handKept: boolean;
  currentCents: number;
  baselineCents: number;
  /**
   * Rows this account has inside the periods asked about, of any kind. A figure can be $0
   * with rows in it (a refund that nets a category below zero is dropped), so "nothing on
   * record" and "an answer cannot change the figure" are read from this, not from the cents.
   */
  rowsInPeriods: number;
}

export interface LeftOutAccount extends AccountSide {
  reasons: LeftOutReason[];
  questions: AccountQuestion[];
}

export interface Driver {
  key: string;
  label: string;
  currentCents: number;
  baselineCents: number;
  /** current − baseline. Across all drivers these sum to the comparison's `deltaCents`, exactly. */
  deltaCents: number;
}

export type Refusal =
  /** A period's start is after its end. */
  | 'order'
  /** A period has not finished: it ends on or after `today`. */
  | 'unfinished'
  /** The two periods share a day. */
  | 'overlap'
  /** An average over fewer than two months. */
  | 'too-few';

export type SameAccountComparison<F extends Figure> =
  | { ok: false; refusal: Refusal }
  | {
      ok: true;
      current: Period;
      baseline: Period;
      /** The caller's own figure for each side, over the included accounts' rows. */
      currentFigure: F;
      baselineFigure: F;
      currentCents: number;
      baselineCents: number;
      /** current − baseline. */
      deltaCents: number;
      /** Whole percent change against the baseline, half away from zero. Null when the baseline is not positive. */
      percent: number | null;
      included: AccountSide[];
      /** Largest on-record amounts first. */
      leftOut: LeftOutAccount[];
      /** Largest absolute change first. Zero-change groups are kept; the caller chooses how many to show. */
      drivers: Driver[];
    };

export interface AccountTotal {
  lineageId: string;
  name: string;
  handKept: boolean;
  /** The account's own figure, month by month, added up. */
  totalCents: number;
  /** Rows inside the run, of any kind (see `AccountSide.rowsInPeriods`). */
  rowsInPeriods: number;
}

export type SameAccountAverage<F extends Figure> =
  | { ok: false; refusal: Refusal }
  | {
      ok: true;
      months: { period: Period; figure: F; cents: number }[];
      totalCents: number;
      /** total ÷ months, half away from zero. */
      meanCents: number;
      included: AccountTotal[];
      leftOut: (AccountTotal & { reasons: LeftOutReason[]; questions: AccountQuestion[] })[];
    };

// ── Dates ────────────────────────────────────────────────────────────────────────────

const onOrBefore = (a: ISODate, b: ISODate) => compareDates(a, b) <= 0;
const before = (a: ISODate, b: ISODate) => compareDates(a, b) < 0;
const later = (a: ISODate, b: ISODate) => (before(a, b) ? b : a);

function refusalFor(periods: readonly Period[], today: ISODate): Refusal | null {
  for (const p of periods) {
    if (before(p.end, p.start)) return 'order';
    if (!before(p.end, today)) return 'unfinished';
  }
  return null;
}

// ── Lineages ─────────────────────────────────────────────────────────────────────────

/**
 * A stretch of days one member's record covers AND whose rows are kept: its first-to-last
 * row span, minus the days the reconciliation boundary drops for it. `startRaw` / `endRaw`
 * say the stretch begins / ends at the record's OWN first / last row — not at a dropped
 * range — so only then can the reader's word or the feed speak to that edge.
 */
interface Segment {
  member: AccountRecord;
  start: ISODate;
  end: ISODate;
  startRaw: boolean;
  endRaw: boolean;
  /** The last day this member's rows are kept, counting on from `end` (the day before its next drop); null = no limit. */
  keptThrough: ISODate | null;
}

/** Days on none of a lineage's kept records, between two segments. */
interface Hole {
  from: ISODate;
  to: ISODate;
  before: Segment;
  after: Segment;
}

/** One or more accounts read as a single record. */
interface Lineage {
  id: string;
  name: string;
  first: ISODate | null;
  last: ISODate | null;
  /** The segment holding the first / last covered day: an edge's word and feed are that member's. */
  firstSeg: Segment | null;
  lastSeg: Segment | null;
  /** The last segment's feed, kept inside that member's kept window; null unless that segment ends at its own last row. */
  completeThrough: ISODate | null;
  feed: 'live' | 'failing' | 'none';
  holes: Hole[];
  /**
   * Days a member HAS a record for whose rows the boundary dropped, and that no other
   * member's kept rows cover: real activity counted nowhere. No answer can recover them.
   */
  lost: { from: ISODate; to: ISODate; member: AccountRecord }[];
  /**
   * The boundary trims at least one of its records. Then no reader's word and no older
   * record's feed proves anything about it — only the days its records keep, and the
   * current record's own feed when no other record shows activity past it (critic cycle
   * 4: with three records, two true "yes" answers about two of them "proved" the third's
   * silence and printed $0.00 as a complete figure).
   */
  trimmed: boolean;
  everSpent: boolean;
  handKept: boolean;
}

/** `[from, to]` minus every interval in `cover` (sorted, inclusive), as inclusive intervals. */
function subtract(from: ISODate, to: ISODate, cover: readonly { start: ISODate; end: ISODate }[]): { from: ISODate; to: ISODate }[] {
  const out: { from: ISODate; to: ISODate }[] = [];
  let cursor: ISODate | null = from;
  for (const c of cover) {
    if (cursor === null || before(to, cursor)) break;
    if (before(c.end, cursor)) continue;
    if (before(to, c.start)) break;
    if (before(cursor, c.start)) out.push({ from: cursor, to: addDays(c.start, -1) });
    cursor = before(c.end, to) ? addDays(c.end, 1) : null;
  }
  if (cursor !== null && onOrBefore(cursor, to)) out.push({ from: cursor, to });
  return out;
}

/** Stable order for ties: by id, so the same inputs always name the same member. */
const byId = (a: AccountRecord, b: AccountRecord) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const END_OF_TIME = '9999-12-31' as ISODate;

/** A member's record as kept stretches: its row span with the boundary's dropped ranges taken out. */
function segmentsOf(m: AccountRecord): Segment[] {
  if (!m.firstRowDate || !m.lastRowDate) return [];
  const first = m.firstRowDate;
  const last = m.lastRowDate;
  const drops = [...(m.dropped ?? [])].sort((a, b) => compareDates(a.from, b.from));
  const out: Segment[] = [];
  let cursor: ISODate | null = first;
  let cursorRaw = true;
  for (const d of drops) {
    if (cursor === null || before(last, cursor)) break;
    if (before(d.to, cursor)) continue; // wholly before what is left
    if (before(cursor, d.from)) {
      const dayBeforeDrop = addDays(d.from, -1);
      const end = before(last, dayBeforeDrop) ? last : dayBeforeDrop;
      out.push({ member: m, start: cursor, end, startRaw: cursorRaw, endRaw: end === last, keptThrough: dayBeforeDrop });
    }
    cursor = compareDates(d.to, END_OF_TIME) >= 0 ? null : later(cursor, addDays(d.to, 1));
    cursorRaw = false;
  }
  if (cursor !== null && onOrBefore(cursor, last)) {
    out.push({ member: m, start: cursor, end: last, startRaw: cursorRaw, endRaw: true, keptThrough: null });
  }
  return out;
}

function lineagesOf(accounts: readonly AccountRecord[]): Map<string, Lineage> {
  const groups = new Map<string, AccountRecord[]>();
  for (const a of accounts) {
    const g = groups.get(a.lineageId);
    if (g) g.push(a);
    else groups.set(a.lineageId, [a]);
  }
  const out = new Map<string, Lineage>();
  for (const [id, unsorted] of groups) {
    const members = [...unsorted].sort(byId);
    const segs = members.flatMap(segmentsOf).sort((a, b) => compareDates(a.start, b.start) || byId(a.member, b.member));
    const firstSeg = segs[0] ?? null;
    let lastSeg: Segment | null = null;
    for (const s of segs) {
      // A tie on the latest day goes to the account that carries the lineage NOW, never to
      // whichever id sorts first (critic cycle 2: the verdict moved with cuid order).
      if (!lastSeg || before(lastSeg.end, s.end) || (compareDates(lastSeg.end, s.end) === 0 && s.member.id === id)) lastSeg = s;
    }
    // Where the kept records do not meet. Each record is taken to have no holes of its own
    // (the one stated assumption); joining records does not extend that to the days between
    // them, and a day the boundary dropped from one record and the other never had is on
    // no kept record at all (critic cycles 1–3).
    const holes: Hole[] = [];
    let reach: Segment | null = null;
    for (const s of segs) {
      if (reach && before(addDays(reach.end, 1), s.start)) {
        holes.push({ from: addDays(reach.end, 1), to: addDays(s.start, -1), before: reach, after: s });
      }
      if (!reach || before(reach.end, s.end)) reach = s;
    }
    // Activity counted nowhere: each member's own record span inside its dropped ranges,
    // minus every kept stretch of the lineage (critic cycle 3: a combined card whose new
    // record's rows were ALL dropped had no stretch at all, and its days read as $0).
    const lost: Lineage['lost'] = [];
    const covered: { start: ISODate; end: ISODate }[] = [];
    for (const sg of segs) {
      const top = covered[covered.length - 1];
      if (top && onOrBefore(sg.start, addDays(top.end, 1))) {
        if (before(top.end, sg.end)) top.end = sg.end;
      } else covered.push({ start: sg.start, end: sg.end });
    }
    for (const m of members) {
      if (!m.firstRowDate || !m.lastRowDate) continue;
      for (const d of m.dropped ?? []) {
        const from = later(m.firstRowDate, d.from);
        const to = before(m.lastRowDate, d.to) ? m.lastRowDate : d.to;
        if (before(to, from)) continue;
        for (const x of subtract(from, to, covered)) lost.push({ ...x, member: m });
      }
    }
    // The lineage is named, and its feed read, from the account that carries it NOW.
    const current = lastSeg?.member ?? members[0]!;
    let completeThrough: ISODate | null = null;
    const trimmed = members.some((m) => (m.dropped?.length ?? 0) > 0);
    // The current record's feed vouches for silence only when no other record has rows past
    // its last one — another record's later activity is not this feed's to vouch for.
    const latestRaw = members.reduce<ISODate | null>((acc, m) => (m.lastRowDate && (!acc || before(acc, m.lastRowDate)) ? m.lastRowDate : acc), null);
    const feedSpeaks = !!lastSeg && (!trimmed || (!!latestRaw && compareDates(lastSeg.member.lastRowDate!, latestRaw) === 0));
    if (lastSeg?.endRaw && current.completeThrough && feedSpeaks) {
      completeThrough =
        lastSeg.keptThrough && before(lastSeg.keptThrough, current.completeThrough) ? lastSeg.keptThrough : current.completeThrough;
    }
    out.set(id, {
      id,
      name: current.name,
      first: firstSeg?.start ?? null,
      last: lastSeg?.end ?? null,
      firstSeg,
      lastSeg,
      completeThrough,
      feed: current.feed,
      holes,
      lost,
      trimmed,
      // Rows the boundary dropped are still spending that happened: a card whose every
      // spending row was dropped is named, not skipped (critic cycle 4, P2-3).
      everSpent: members.some((m) => m.everSpent) || lost.length > 0,
      handKept: members.some((m) => m.handKept),
    });
  }
  return out;
}

/** The reader's word about an edge counts only for the edge date it was given for. */
function wordFor(word: EdgeWord | null | undefined, edgeDate: ISODate | null): EdgeWord['verdict'] | null {
  return word && edgeDate && compareDates(word.forDate, edgeDate) === 0 ? word.verdict : null;
}

/** Whether `h.before`'s own feed has delivered the whole hole, inside the days its rows are kept. */
function holeFed(h: Hole): boolean {
  const ct = h.before.member.completeThrough;
  return !!ct && onOrBefore(h.to, ct) && (h.before.keptThrough === null || onOrBefore(h.to, h.before.keptThrough));
}

/** A hole sits between a record's OWN last row and another's OWN first row — not at a drop. */
const provable = (h: Hole) => h.before.endRaw && h.after.startRaw;

/**
 * Whether a lineage's record is whole across `span`, and if not, why.
 *
 * Start: a covered day on or before the span's first day — or the reader's word that the
 * first row is when the account began. End: a covered day on or after the span's last day —
 * or a live feed that has succeeded through it — or the reader's word that the last row is
 * when it was last used. Between: no hole touching the span, unless the hole is provably a
 * stretch of nothing (the next record began there AND the one before was complete to it).
 */
function reasonsFor(l: Lineage, span: Period): LeftOutReason[] {
  const reasons: LeftOutReason[] = [];
  if (!l.first || !l.last || !l.firstSeg || !l.lastSeg) {
    // Spent, but nothing on record up to today: never "complete" (critic cycle 4, P2-4).
    if (l.everSpent) reasons.push({ edge: 'empty', told: false });
    return reasons;
  }
  // A trimmed lineage takes no word (see `Lineage.trimmed`).
  const startWord = !l.trimmed && l.firstSeg.startRaw ? wordFor(l.firstSeg.member.startWord, l.firstSeg.member.firstRowDate) : null;
  const endWord = !l.trimmed && l.lastSeg.endRaw ? wordFor(l.lastSeg.member.endWord, l.lastSeg.member.lastRowDate) : null;

  const startOk = onOrBefore(l.first, span.start) || startWord === 'real';
  if (!startOk) reasons.push({ edge: 'start', date: l.first, told: startWord === 'missing' });

  const through = l.completeThrough ? later(l.last, l.completeThrough) : l.last;
  const endOk = onOrBefore(span.end, through) || endWord === 'real';
  if (!endOk) reasons.push({ edge: 'end', through, feed: l.feed, told: endWord === 'missing' });

  for (const h of l.holes) {
    if (before(span.end, h.from) || before(h.to, span.start)) continue;
    const can = provable(h) && !l.trimmed;
    const began = can ? wordFor(h.after.member.startWord, h.after.member.firstRowDate) : null;
    const ended = can ? wordFor(h.before.member.endWord, h.before.member.lastRowDate) : null;
    if (can && began === 'real' && (ended === 'real' || holeFed(h))) continue;
    reasons.push({
      edge: 'gap',
      from: h.from,
      to: h.to,
      // For a hole the boundary made, `before` names the record whose days stopped counting.
      before: provable(h) || !h.before.endRaw ? h.before.member.name : h.after.member.name,
      after: h.after.member.name,
      told: began === 'missing' || ended === 'missing',
      dropped: !provable(h),
    });
  }
  for (const x of l.lost) {
    if (before(span.end, x.from) || before(x.to, span.start)) continue;
    // A lost range is never hidden behind a gap that starts the same day (critic cycle 4, P2-1).
    const same = reasons.findIndex((r) => r.edge === 'gap' && r.from === x.from);
    if (same >= 0) {
      // Keep the wider of the two stretches, named for the record whose days were dropped.
      const g = reasons[same] as Extract<LeftOutReason, { edge: 'gap' }>;
      reasons[same] = { ...g, to: before(g.to, x.to) ? x.to : g.to, before: x.member.name, dropped: true, told: false };
    } else {
      reasons.push({ edge: 'gap', from: x.from, to: x.to, before: x.member.name, after: l.name, told: false, dropped: true });
    }
  }
  return reasons;
}

/**
 * The question for each reason a question can settle. A connected account whose record
 * stops short is a connection to mend or wait for, not something to ask the reader; an
 * edge the reader has already spoken to is not asked again; and a hole made by the
 * boundary's drops can be settled by no answer at all.
 */
function questionsFor(l: Lineage, reasons: readonly LeftOutReason[]): AccountQuestion[] {
  const out: AccountQuestion[] = [];
  const ask = (m: AccountRecord, edge: 'start' | 'end', date: ISODate) => {
    if (!out.some((q) => q.accountId === m.id && q.edge === edge)) out.push({ accountId: m.id, accountName: m.name, edge, date });
  };
  // No question while nothing an answer says could count: a trimmed lineage, or a reason no answer settles.
  if (l.trimmed || reasons.some((r) => (r.edge === 'gap' && r.dropped) || r.edge === 'empty')) return out;
  for (const r of reasons) {
    if (r.told) continue;
    if (r.edge === 'start' && l.firstSeg?.startRaw) {
      ask(l.firstSeg.member, 'start', l.firstSeg.member.firstRowDate!);
    } else if (r.edge === 'end' && r.feed === 'none' && l.lastSeg?.endRaw) {
      ask(l.lastSeg.member, 'end', l.lastSeg.member.lastRowDate!);
    } else if (r.edge === 'gap' && !r.dropped) {
      const h = l.holes.find((x) => x.from === r.from);
      if (!h) continue;
      // Each half of the proof is asked only while it is still open.
      if (wordFor(h.after.member.startWord, h.after.member.firstRowDate) !== 'real') ask(h.after.member, 'start', h.after.member.firstRowDate!);
      if (!holeFed(h) && h.before.member.feed === 'none' && wordFor(h.before.member.endWord, h.before.member.lastRowDate) !== 'real') {
        ask(h.before.member, 'end', h.before.member.lastRowDate!);
      }
    }
  }
  return out;
}

/** The smallest span covering every period given. */
function hull(periods: readonly Period[]): Period {
  let start = periods[0]!.start;
  let end = periods[0]!.end;
  for (const p of periods) {
    if (before(p.start, start)) start = p.start;
    if (before(end, p.end)) end = p.end;
  }
  return { start, end };
}

/** How many of `rows` fall inside any of `periods`. */
function countIn<R extends { accountId: string }>(rows: readonly R[], periods: readonly Period[], dateOf: (r: R) => string): number {
  return rows.filter((r) => periods.some((p) => onOrBefore(p.start, dateOf(r) as ISODate) && onOrBefore(dateOf(r) as ISODate, p.end))).length;
}

/** Rows split by the lineage of the account they belong to. A row for an unknown account is a caller bug. */
function rowsByLineage<R extends { accountId: string }>(
  rows: readonly R[],
  accounts: readonly AccountRecord[],
): Map<string, R[]> {
  const lineageOf = new Map(accounts.map((a) => [a.id, a.lineageId]));
  const out = new Map<string, R[]>();
  for (const row of rows) {
    const id = lineageOf.get(row.accountId);
    if (id === undefined) throw new Error(`same-account: row for an account that was not described (${row.accountId})`);
    const list = out.get(id);
    if (list) list.push(row);
    else out.set(id, [row]);
  }
  return out;
}

// ── Integer arithmetic ───────────────────────────────────────────────────────────────

/** n ÷ d rounded half away from zero, in integers. d > 0. */
function divRound(n: number, d: number): number {
  const sign = n < 0 ? -1 : 1;
  return sign * Math.floor((2 * Math.abs(n) + d) / (2 * d));
}

const byAmountThenName = <T extends { name: string }>(amount: (x: T) => number) => (a: T, b: T) =>
  amount(b) - amount(a) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// ── Compare ──────────────────────────────────────────────────────────────────────────

export function compareSameAccounts<R extends { accountId: string; date: string }, F extends Figure>(input: {
  rows: readonly R[];
  accounts: readonly AccountRecord[];
  current: Period;
  baseline: Period;
  today: ISODate;
  /** The caller's spending figure for a set of rows over a period. */
  figure: (rows: readonly R[], period: Period) => F;
}): SameAccountComparison<F> {
  const { rows, accounts, current, baseline, today, figure } = input;
  const refusal = refusalFor([current, baseline], today);
  if (refusal) return { ok: false, refusal };
  if (onOrBefore(current.start, baseline.end) && onOrBefore(baseline.start, current.end)) {
    return { ok: false, refusal: 'overlap' };
  }

  const lineages = lineagesOf(accounts);
  const byLineage = rowsByLineage(rows, accounts);

  const included: AccountSide[] = [];
  const leftOut: LeftOutAccount[] = [];
  const includedRows: R[] = [];
  for (const l of lineages.values()) {
    if (!l.everSpent) continue;
    // A lineage must be whole across each period on its own — NOT across the gap between
    // them: comparing May with March asks nothing of April. One reason per edge, however
    // many periods it fails.
    const seen = new Set<string>();
    const reasons: LeftOutReason[] = [];
    for (const r of [...reasonsFor(l, baseline), ...reasonsFor(l, current)]) {
      const key = r.edge === 'gap' ? `gap:${r.from}` : r.edge;
      if (seen.has(key)) continue;
      seen.add(key);
      reasons.push(r);
    }
    const own = byLineage.get(l.id) ?? [];
    const side: AccountSide = {
      lineageId: l.id,
      name: l.name,
      handKept: l.handKept,
      currentCents: figure(own, current).totalCents,
      baselineCents: figure(own, baseline).totalCents,
      rowsInPeriods: countIn(own, [current, baseline], (r) => r.date),
    };
    if (reasons.length === 0) {
      included.push(side);
      includedRows.push(...own);
    } else {
      leftOut.push({ ...side, reasons, questions: questionsFor(l, reasons) });
    }
  }
  const size = (a: AccountSide) => Math.abs(a.currentCents) + Math.abs(a.baselineCents);
  included.sort(byAmountThenName(size));
  leftOut.sort(byAmountThenName(size));

  const currentFigure = figure(includedRows, current);
  const baselineFigure = figure(includedRows, baseline);
  const currentCents = currentFigure.totalCents;
  const baselineCents = baselineFigure.totalCents;
  const deltaCents = currentCents - baselineCents;

  const groups = new Map<string, Driver>();
  const group = (key: string, label: string) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label, currentCents: 0, baselineCents: 0, deltaCents: 0 }));
    return g;
  };
  for (const g of currentFigure.groups) group(g.key, g.label).currentCents += g.cents;
  for (const g of baselineFigure.groups) group(g.key, g.label).baselineCents += g.cents;
  const drivers = [...groups.values()]
    .map((g) => ({ ...g, deltaCents: g.currentCents - g.baselineCents }))
    .sort(
      (a, b) =>
        Math.abs(b.deltaCents) - Math.abs(a.deltaCents) || (a.label < b.label ? -1 : a.label > b.label ? 1 : a.key < b.key ? -1 : 1),
    );

  return {
    ok: true,
    current,
    baseline,
    currentFigure,
    baselineFigure,
    currentCents,
    baselineCents,
    deltaCents,
    percent: baselineCents > 0 ? divRound(deltaCents * 100, baselineCents) : null,
    included,
    leftOut,
    drivers,
  };
}

// ── Average ──────────────────────────────────────────────────────────────────────────

/**
 * The monthly average across `months`, on the accounts whose records are whole across
 * the entire run — first day of the first month to last day of the last. (Unlike a
 * comparison, an average does ask something of every month in between.)
 *
 * Each month is the caller's figure for that month on its own, so every month shown is
 * the number the app gives when asked about that month alone.
 */
export function averageSameAccounts<R extends { accountId: string; date: string }, F extends Figure>(input: {
  rows: readonly R[];
  accounts: readonly AccountRecord[];
  /** Finished periods, in order, sharing no day. */
  months: readonly Period[];
  today: ISODate;
  figure: (rows: readonly R[], period: Period) => F;
}): SameAccountAverage<F> {
  const { rows, accounts, months, today, figure } = input;
  if (months.length < 2) return { ok: false, refusal: 'too-few' };
  const refusal = refusalFor(months, today);
  if (refusal) return { ok: false, refusal };
  for (let i = 1; i < months.length; i++) {
    if (!before(months[i - 1]!.end, months[i]!.start)) return { ok: false, refusal: 'overlap' };
  }

  const lineages = lineagesOf(accounts);
  const byLineage = rowsByLineage(rows, accounts);
  const span = hull(months);

  const included: AccountTotal[] = [];
  const leftOut: (AccountTotal & { reasons: LeftOutReason[]; questions: AccountQuestion[] })[] = [];
  const includedRows: R[] = [];
  for (const l of lineages.values()) {
    if (!l.everSpent) continue;
    const reasons = reasonsFor(l, span);
    const own = byLineage.get(l.id) ?? [];
    const account: AccountTotal = {
      lineageId: l.id,
      name: l.name,
      handKept: l.handKept,
      totalCents: months.reduce((n, m) => n + figure(own, m).totalCents, 0),
      rowsInPeriods: countIn(own, months, (r) => r.date),
    };
    if (reasons.length === 0) {
      included.push(account);
      includedRows.push(...own);
    } else {
      leftOut.push({ ...account, reasons, questions: questionsFor(l, reasons) });
    }
  }
  included.sort(byAmountThenName((a) => Math.abs(a.totalCents)));
  leftOut.sort(byAmountThenName((a) => Math.abs(a.totalCents)));

  const perMonth = months.map((period) => {
    const f = figure(includedRows, period);
    return { period, figure: f, cents: f.totalCents };
  });
  const totalCents = perMonth.reduce((n, m) => n + m.cents, 0);
  return {
    ok: true,
    months: perMonth,
    totalCents,
    meanCents: divRound(totalCents, months.length),
    included,
    leftOut,
  };
}
