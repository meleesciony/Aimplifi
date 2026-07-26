/**
 * Glass-Box share redaction (TASKS 1.6 / DECISIONS #202).
 *
 * Pure: takes a NumberTrace and returns a share-safe copy. Amounts, dates,
 * autopay cents, estimate flags, sum, and reconciliation are UNCHANGED —
 * only identifying labels/notes are genericized. Never recomputes money.
 *
 * Cash-needed row labels are card names (PII-ish) → "Card 1", "Card 2", …
 * Safe-to-spend labels are already generic category names — kept.
 * Notes may mention accounts/autopay details → stripped (or a generic
 * autopay line when autopayCents > 0).
 */
import type { NumberTrace, TraceRow } from '@/lib/engine/glass-box/trace';

function redactRow(row: TraceRow, index: number, key: NumberTrace['key']): TraceRow {
  const label = key === 'cash_needed' ? `Card ${index + 1}` : row.label;
  const notes =
    (row.autopayCents ?? 0) > 0 ? ['Part of this row is covered by autopay.'] : [];
  return { ...row, label, notes };
}

/** Share-safe copy of a trace. Amounts and sumCents are byte-identical. */
export function redactTraceForShare(trace: NumberTrace): NumberTrace {
  return {
    ...trace,
    rows: trace.rows.map((r, i) => redactRow(r, i, trace.key)),
  };
}

const HEADLINE: Record<NumberTrace['key'], string> = {
  cash_needed: 'Cash needed',
  safe_to_spend: 'Guilt-free to spend',
};

/**
 * Plain-text snapshot for clipboard. No card names, no account names —
 * only the redacted labels + amounts + reconciliation line.
 */
export function formatShareText(trace: NumberTrace): string {
  const redacted = redactTraceForShare(trace);
  const lines: string[] = [
    'Ask Aimplifi · Glass-Box',
    `${HEADLINE[redacted.key]}: ${formatCentsPlain(redacted.headlineCents)}`,
    '',
  ];
  for (const r of redacted.rows) {
    const bits = [r.label];
    if (r.date) bits.push(`due ${r.date}`);
    if ((r.autopayCents ?? 0) > 0) bits.push('autopay');
    if (r.isEstimated) bits.push('est.');
    lines.push(`${bits.join(' · ')} — ${formatCentsPlain(r.amountCents)}`);
  }
  lines.push('');
  lines.push(`Total: ${formatCentsPlain(redacted.sumCents)}`);
  if (redacted.reconciles) {
    const n = redacted.rows.length;
    lines.push(
      n === 1
        ? 'This row adds up to exactly the number above — matched to the penny.'
        : `These ${n} rows add up to exactly the number above — matched to the penny.`,
    );
  } else {
    lines.push('These rows do not add up exactly — share is disabled for mismatched traces.');
  }
  for (const b of redacted.basis) lines.push(b);
  lines.push('');
  lines.push('Names redacted. Amounts from your own data; nothing invented. Nothing left this device.');
  return lines.join('\n');
}

/** Minimal signed-cents formatter for share text (UI still uses formatCents). */
function formatCentsPlain(amount: number): string {
  const neg = amount < 0;
  const abs = Math.abs(amount);
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  const body = `$${dollars.toLocaleString('en-US')}.${String(cents).padStart(2, '0')}`;
  return neg ? `−${body}` : body;
}
