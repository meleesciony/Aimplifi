'use client';

/**
 * CSV import form. Posts to the importTransactionsCsv server action via
 * useActionState so the imported/skipped counts and per-row errors render
 * inline without leaving the page.
 */
import Link from 'next/link';
import { useActionState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { type ImportResult, importTransactionsCsv } from '@/server/transaction-actions';

const fieldClass =
  'w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';

export function ImportCsvForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const [result, action, pending] = useActionState<ImportResult | null, FormData>(
    importTransactionsCsv,
    null,
  );

  return (
    <Card>
      <CardContent className="pt-5">
        <form action={action} className="space-y-4" data-testid="import-csv-form">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Into account</span>
            <select name="accountId" required data-testid="import-account" className={`h-9 ${fieldClass}`}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Paste CSV</span>
            <textarea
              name="csv"
              required
              rows={8}
              data-testid="import-csv-text"
              placeholder={'date,description,amount\n2026-06-01,Coffee shop,-4.50\n2026-06-01,Paycheck,2500.00'}
              className={`py-2 font-mono text-xs ${fieldClass}`}
            />
            <span className="text-xs text-muted-foreground">
              Columns: <code>date</code>, <code>description</code>, <code>amount</code> (and
              optional <code>category</code>). Amount is negative for money out, positive
              for money in. Dates as YYYY-MM-DD or MM/DD/YYYY.
            </span>
          </label>

          <div className="flex gap-2">
            <Button type="submit" disabled={pending} data-testid="import-submit">
              {pending ? 'Importing…' : 'Import'}
            </Button>
            <Link href="/transactions" className={buttonVariants({ variant: 'ghost' })}>
              Back
            </Link>
          </div>
        </form>

        {result && (
          <div className="mt-4 space-y-2 border-t pt-4 text-sm" data-testid="import-result">
            <p className={result.imported > 0 ? 'text-emerald-500' : 'text-red-400'}>
              {result.imported > 0 && <CheckCircle2 className="mr-1 inline size-4" aria-hidden />}
              Imported {result.imported} transaction{result.imported === 1 ? '' : 's'}
              {result.skipped > 0 ? `, skipped ${result.skipped}` : ''}.
            </p>
            {result.errors.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground" data-testid="import-errors">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            {result.imported > 0 && (
              <Link
                href="/transactions"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                data-testid="import-view"
              >
                View transactions
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
