'use client';

/**
 * Inline editor for a manual credit card's current statement (extends DECISIONS
 * #45). Collects the statement balance, minimum, closing + due dates, an optional
 * APR, and an optional autopay mode — exactly what the Cash-Needed Engine needs to
 * answer "how much do I need & when" precisely for a card with no bank feed.
 * Validation is server-side (parseManualStatement); errors surface via the parent.
 *
 * Doc Extractor v1 (AI plan §3.3, DECISIONS #247): an optional paste-text panel
 * can PREFILL these fields from statement text. The AI only points at spans;
 * every value shown here was copied out of the pasted text by code, each
 * prefill renders next to its quoted source span for the human to check, and
 * saving still runs the exact same server-side gate as hand-typed values.
 */
import { useState } from 'react';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import {
  EXTRACT_FIELD_IDS,
  EXTRACT_FIELD_LABELS,
  type ExtractFieldId,
  type GroundedField,
} from '@/lib/engine/doc-extract/statement';
import { extractStatementDraft } from '@/server/card-actions';
import type { ManualCardBilling } from '@/server/transactions';

export interface ManualStatementFormValues {
  statementBalance: string;
  minimumPayment: string;
  cycleEnd: string;
  dueDate: string;
  apr: string;
  autopayMode: string;
  autopayFixedAmount: string;
}

const AUTOPAY_OPTIONS: { id: string; label: string }[] = [
  { id: 'NONE', label: 'No autopay' },
  { id: 'STATEMENT_BALANCE', label: 'Autopay: statement balance' },
  { id: 'MINIMUM', label: 'Autopay: minimum payment' },
  { id: 'FIXED_AMOUNT', label: 'Autopay: fixed amount' },
];

function dollars(cents?: number | null): string {
  return cents != null ? (cents / 100).toFixed(2) : '';
}

export function ManualCardStatementForm({
  billing,
  pending,
  onCancel,
  onSubmit,
}: {
  billing?: ManualCardBilling;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (values: ManualStatementFormValues) => void;
}) {
  const [statementBalance, setStatementBalance] = useState(dollars(billing?.statementBalanceCents));
  const [minimumPayment, setMinimumPayment] = useState(dollars(billing?.minimumPaymentCents));
  const [cycleEnd, setCycleEnd] = useState(billing?.cycleEnd ?? '');
  const [dueDate, setDueDate] = useState(billing?.dueDate ?? '');
  const [apr, setApr] = useState(billing?.aprBps != null ? (billing.aprBps / 100).toFixed(2) : '');
  const [autopayMode, setAutopayMode] = useState(billing?.autopayMode ?? 'NONE');
  const [autopayFixedAmount, setAutopayFixedAmount] = useState(dollars(billing?.autopayFixedAmountCents));

  // Doc Extractor v1 paste panel (#247). Read-only round-trip: the action never
  // writes; grounded values land in the SAME controlled fields the user could
  // have typed, and Save runs the same gate either way.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<GroundedField[] | null>(null);
  const [abstained, setAbstained] = useState<ExtractFieldId[]>([]);

  async function runExtract() {
    setExtracting(true);
    setExtractError(null);
    setExtracted(null);
    setAbstained([]);
    try {
      const out = await withDeadline(extractStatementDraft({ text: pasteText }));
      if (!out.ok || !out.fields) {
        setExtractError(out.error ?? 'Extraction failed — you can enter the fields manually.');
        return;
      }
      for (const f of out.fields) {
        if (f.field === 'statementBalance') setStatementBalance(f.value);
        else if (f.field === 'minimumPayment') setMinimumPayment(f.value);
        else if (f.field === 'cycleEnd') setCycleEnd(f.value);
        else if (f.field === 'dueDate') setDueDate(f.value);
        else if (f.field === 'apr') setApr(f.value);
      }
      setExtracted(out.fields);
      setAbstained(out.abstained ?? []);
    } catch (e) {
      setExtractError(
        e instanceof ActionDeadline
          ? 'Extraction didn’t confirm in time — you can enter the fields manually.'
          : 'Extraction failed — you can enter the fields manually.',
      );
    } finally {
      setExtracting(false);
    }
  }

  const extractedIds = new Set((extracted ?? []).map((f) => f.field));
  const notFound = EXTRACT_FIELD_IDS.filter(
    (id) => !extractedIds.has(id) && !abstained.includes(id),
  );

  const labelCls = 'text-xs text-muted-foreground';
  const inputCls = 'w-full rounded-md border bg-background px-2 py-1.5 text-sm';

  return (
    <div
      className="mt-2 space-y-2 rounded-lg border p-3"
      data-testid="card-statement-form"
      role="group"
      aria-label="Current statement"
    >
      <p className="text-sm font-medium">Current statement</p>
      <p className="text-xs text-muted-foreground">
        With a statement, this card joins your “how much do I need &amp; when” answer instead of being
        net-worth-only. Update it when a new statement closes.
      </p>

      {!pasteOpen ? (
        <button
          type="button"
          data-testid="cs-extract-toggle"
          disabled={pending || extracting}
          onClick={() => setPasteOpen(true)}
          className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          Prefill from statement text (AI)
        </button>
      ) : (
        <div className="space-y-2 rounded-md border border-dashed p-2" data-testid="cs-extract-panel">
          <label className="space-y-1">
            <span className={labelCls}>Paste your statement’s summary text</span>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={5}
              placeholder={'Statement period: 06/15/2026 - 07/14/2026\nNew balance $1,234.56\nMinimum payment due $35.00 …'}
              data-testid="cs-extract-text"
              className={inputCls}
            />
          </label>
          <p className="text-xs text-muted-foreground" data-testid="cs-extract-disclosure">
            The text you paste is sent to an AI model to find <em>where</em> each field appears. We
            strip long runs of digits (like card and account numbers) first, but that can miss unusual
            formats — paste only the statement’s summary section, not personal details. The AI only
            points — every value below is copied out of your text by this app’s own code, shown with
            its source line, and nothing is saved until you press Save.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="cs-extract-run"
              disabled={pending || extracting}
              onClick={() => void runExtract()}
              className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {extracting ? 'Reading…' : 'Extract fields'}
            </button>
            <button
              type="button"
              disabled={extracting}
              onClick={() => {
                setPasteOpen(false);
                setExtractError(null);
              }}
              className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              Hide
            </button>
          </div>
          {extractError && (
            <p className="text-xs text-destructive" data-testid="cs-extract-error" role="alert">
              {extractError}
            </p>
          )}
          {extracted && (
            <div className="space-y-1" data-testid="cs-extract-summary" role="status">
              <ul className="space-y-0.5">
                {extracted.map((f) => (
                  <li key={f.field} className="text-xs">
                    <span className="font-medium">{EXTRACT_FIELD_LABELS[f.field]}</span>{' '}
                    <span className="text-muted-foreground">
                      ← “{f.sourceSpan.trim()}” ({Math.round(f.confidenceBps / 100)}% confident)
                    </span>
                  </li>
                ))}
              </ul>
              {(abstained.length > 0 || notFound.length > 0) && (
                <p className="text-xs text-muted-foreground" data-testid="cs-extract-gaps">
                  Enter by hand:{' '}
                  {[...abstained, ...notFound].map((id) => EXTRACT_FIELD_LABELS[id]).join(', ')}
                  {abstained.length > 0 && ' (some couldn’t be read unambiguously)'}.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Check each value against your statement before saving.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className={labelCls}>Statement balance</span>
          <input type="text" inputMode="decimal" placeholder="1200.00" value={statementBalance}
            onChange={(e) => setStatementBalance(e.target.value)} data-testid="cs-balance" disabled={extracting} className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Minimum payment</span>
          <input type="text" inputMode="decimal" placeholder="35.00" value={minimumPayment}
            onChange={(e) => setMinimumPayment(e.target.value)} data-testid="cs-min" disabled={extracting} className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Closing date</span>
          <input type="date" value={cycleEnd} onChange={(e) => setCycleEnd(e.target.value)}
            data-testid="cs-close" disabled={extracting} className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Due date</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            data-testid="cs-due" disabled={extracting} className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>APR % (optional)</span>
          <input type="text" inputMode="decimal" placeholder="24.99" value={apr}
            onChange={(e) => setApr(e.target.value)} data-testid="cs-apr" disabled={extracting} className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Autopay (optional)</span>
          <select value={autopayMode} onChange={(e) => setAutopayMode(e.target.value)}
            data-testid="cs-autopay" className="h-[34px] w-full rounded-md border border-input bg-background px-2 text-sm">
            {AUTOPAY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </label>
        {autopayMode === 'FIXED_AMOUNT' && (
          <label className="space-y-1">
            <span className={labelCls}>Fixed autopay amount</span>
            <input type="text" inputMode="decimal" placeholder="100.00" value={autopayFixedAmount}
              onChange={(e) => setAutopayFixedAmount(e.target.value)} data-testid="cs-fixed" className={inputCls} />
          </label>
        )}
      </div>
      {apr.trim() === '' && (
        <p className="text-xs text-muted-foreground" data-testid="cs-apr-note">
          No APR entered — we’ll show $0 interest for this card on the minimum-payment path until you add one.
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          data-testid="cs-save"
          // Also gated on `extracting`: a resolving prefill rewrites the five
          // fields, so saving (or hand-editing being overwritten) mid-flight
          // must be impossible (critic #247 cycle-1 P2-3).
          disabled={pending || extracting}
          onClick={() => onSubmit({ statementBalance, minimumPayment, cycleEnd, dueDate, apr, autopayMode, autopayFixedAmount })}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
        >
          Save statement
        </button>
        <button type="button" disabled={pending} onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  );
}
