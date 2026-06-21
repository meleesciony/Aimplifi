'use client';

/**
 * Inline editor for a manual credit card's current statement (extends DECISIONS
 * #45). Collects the statement balance, minimum, closing + due dates, an optional
 * APR, and an optional autopay mode — exactly what the Cash-Needed Engine needs to
 * answer "how much do I need & when" precisely for a card with no bank feed.
 * Validation is server-side (parseManualStatement); errors surface via the parent.
 */
import { useState } from 'react';
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
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className={labelCls}>Statement balance</span>
          <input type="text" inputMode="decimal" placeholder="1200.00" value={statementBalance}
            onChange={(e) => setStatementBalance(e.target.value)} data-testid="cs-balance" className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Minimum payment</span>
          <input type="text" inputMode="decimal" placeholder="35.00" value={minimumPayment}
            onChange={(e) => setMinimumPayment(e.target.value)} data-testid="cs-min" className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Closing date</span>
          <input type="date" value={cycleEnd} onChange={(e) => setCycleEnd(e.target.value)}
            data-testid="cs-close" className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>Due date</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            data-testid="cs-due" className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className={labelCls}>APR % (optional)</span>
          <input type="text" inputMode="decimal" placeholder="24.99" value={apr}
            onChange={(e) => setApr(e.target.value)} data-testid="cs-apr" className={inputCls} />
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
          disabled={pending}
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
