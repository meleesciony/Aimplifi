/**
 * TASKS H.2 — per-institution "how to export your CSV" cards for
 * /transactions/import. Server component: pure copy, keyed to the institution
 * names the user actually has connected (PlaidItem.institution); institutions
 * without a verified card get the generic guide instead. Copy lives in
 * src/lib/engine/transactions/csv-export-guide.ts (web-verified, unit-tested).
 */
import { GENERIC_CSV_GUIDE, csvExportGuideFor, type CsvExportGuide } from '@/lib/engine/transactions/csv-export-guide';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function CsvImportGuides({ institutions }: { institutions: string[] }) {
  // One card per guide, in the user's institution order; two names that resolve
  // to the same guide (e.g. "Amex" + "American Express") render once.
  const cards: CsvExportGuide[] = [];
  const seen = new Set<string>();
  for (const name of institutions) {
    const guide = csvExportGuideFor(name);
    if (guide && !seen.has(guide.institution)) {
      seen.add(guide.institution);
      cards.push(guide);
    }
  }
  cards.push(GENERIC_CSV_GUIDE);

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold">How to export from your bank</h2>
      <p className="text-xs text-muted-foreground">
        These routes are the banks we see on your accounts. Banks that only offer PDF
        statements can&apos;t backfill via CSV — the synced feed is their history.
      </p>
      {cards.map((g) => (
        <Card key={g.institution}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{g.institution}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
              {g.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            {g.note && <p className="text-xs text-amber-700 dark:text-amber-300">{g.note}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
