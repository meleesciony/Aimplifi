'use client';

/**
 * Manual transaction entry form. Posts to the createManualTransaction server
 * action. Direction (out/in) and an optional explicit category; leaving the
 * category on "Auto-detect" runs the categorization pipeline server-side.
 */
import { useState } from 'react';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CATEGORIES } from '@/lib/engine/categorize/categories';
import { createManualTransaction } from '@/server/transaction-actions';

const CATEGORY_OPTIONS = CATEGORIES.filter((c) => c.id !== 'uncategorized');
const fieldClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';

export function AddTransactionForm({
  accounts,
  defaultDate,
}: {
  accounts: { id: string; name: string }[];
  defaultDate: string;
}) {
  const [direction, setDirection] = useState<'out' | 'in'>('out');

  return (
    <Card>
      <CardContent className="pt-5">
        <form action={createManualTransaction} className="space-y-4" data-testid="add-txn-form">
          <input type="hidden" name="direction" value={direction} />
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Direction">
            <button
              type="button"
              aria-pressed={direction === 'out'}
              onClick={() => setDirection('out')}
              data-testid="dir-out"
              className={`h-9 rounded-md border text-sm ${
                direction === 'out' ? 'border-foreground bg-accent font-medium' : 'border-input'
              }`}
            >
              Money out
            </button>
            <button
              type="button"
              aria-pressed={direction === 'in'}
              onClick={() => setDirection('in')}
              data-testid="dir-in"
              className={`h-9 rounded-md border text-sm ${
                direction === 'in' ? 'border-foreground bg-accent font-medium' : 'border-input'
              }`}
            >
              Money in
            </button>
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Description</span>
            <input
              name="descriptor"
              required
              placeholder="e.g. Farmers market, check #142"
              data-testid="txn-descriptor"
              className={fieldClass}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Amount</span>
              <input
                name="amount"
                required
                inputMode="decimal"
                placeholder="0.00"
                data-testid="txn-amount"
                className={fieldClass}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium">Date</span>
              <input
                type="date"
                name="date"
                required
                defaultValue={defaultDate}
                data-testid="txn-date"
                className={fieldClass}
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Account</span>
            <select name="accountId" required data-testid="txn-account" className={fieldClass}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Category</span>
            <select name="categoryId" data-testid="txn-category" className={fieldClass}>
              <option value="">Auto-detect</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              Leave on Auto-detect to let Aimplifi categorize it (ambiguous ones go
              to your Inbox).
            </span>
          </label>

          <p className="text-xs text-muted-foreground">
            This records activity for tracking and categories. It doesn&apos;t
            change an account&apos;s reported balance.
          </p>

          <div className="flex gap-2">
            <Button type="submit" data-testid="txn-submit">
              Add transaction
            </Button>
            <Link href="/transactions" className={buttonVariants({ variant: 'ghost' })}>
              Cancel
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
