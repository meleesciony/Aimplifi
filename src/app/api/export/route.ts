/**
 * Data export (Phase 4): /api/export?format=transactions-csv|net-worth-csv|net-worth-pdf
 * Auth required; every export is audit-logged; rate-limited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { auditLog, rateLimitDurable } from '@/server/authz';
import { getDashboardData } from '@/server/finance';
import { netWorthReportPdf, netWorthToCsv, transactionsToCsv } from '@/lib/export';
import { categoryName } from '@/lib/engine/categorize/categories';
import { getCategoryMeta } from '@/server/category-meta';
import { getWithheldRegisterAccountSummary, registerRowWhere } from '@/server/transactions';
import {
  activeSupersededPredecessorIds,
  getReconciliationHandoverKeys,
  getReconciliationTxnKeep,
} from '@/server/reconciliation';
import { handoverKey } from '@/lib/engine/account/reconcile-boundary';
import { accountLabel } from '@/lib/engine/account/display-name';
import { getTaxExport } from '@/server/tax';
import { taxExportFilename, taxExportToCsv } from '@/lib/engine/tax/csv';

export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Durable limit (holds across serverless instances, ROADMAP #8). Fails CLOSED:
  // if the limiter DB call throws, the export is denied (500) rather than served
  // unthrottled — the safe default for a data-export endpoint.
  if (!(await rateLimitDurable(`export:${userId}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many export requests' }, { status: 429 });
  }

  const format = request.nextUrl.searchParams.get('format') ?? 'transactions-csv';

  if (format === 'transactions-csv') {
    const rawTxns = await prisma.transaction.findMany({
      // THE REGISTER'S OWN CLAUSE, not a copy of it (U.23). This route used to build its
      // own — spending accounts (#62) and nothing else — while claiming below that "the
      // exported ledger must match the in-app register", and it did not: the clause was
      // missing `isSplitParent: false`, so every split shipped as the parent CONTAINER
      // plus its children and a reader summing the amount column counted it twice, and it
      // was missing the currency guard (#135), so rows the register withholds for having
      // no exchange rate landed unlabelled in a column of dollars. Measured on the repro
      // that opened U.23: 4 rows / -$299.00 exported against the register's 2 / -$100.00.
      // Sharing the expression is what makes the claim true by construction — a second
      // copy is how a reader starts disagreeing with the register (H.8).
      where: registerRowWhere(userId),
      // Join the category as a BACKSTOP only. The name that ships is resolved
      // below through the reader's own merged meta, because a built-in category
      // they renamed (O.17) keeps the canonical `Category.name` in the DB — the
      // rename is a per-user overlay row — so exporting the join would hand them
      // a file labelled differently from every screen they read it on.
      include: { account: { select: { name: true, displayName: true } }, merchant: true, category: { select: { name: true } } },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    // Reconciliation boundary (slice-6 critic C-2): the exported ledger must match the
    // in-app register/reports — without this, a reconciled pair's overlap rows exported
    // both providers' copies of every real transaction. Same shared R1 rule as the register.
    const keepsReconciled = await getReconciliationTxnKeep(userId);
    // U.19: the ACCOUNT-scoped set, never `getReconciliationHandoverDates`. The
    // tax export is right to use the unscoped dates — it has no account column,
    // so it can only speak about the day — but this file has one, and marking
    // every account's rows on that date would label ordinary purchases on
    // accounts that are in no combined pair at all. That is the exact defect
    // U.16's second critic cycle found on the panels: a set carries the scope it
    // was built for.
    const handoverKeys = await getReconciliationHandoverKeys(userId);
    // The reader's own vocabulary: their custom categories plus any built-in they
    // renamed. Same resolver the register, reports and Ask read.
    const categoryMeta = await getCategoryMeta(userId);
    // What the currency guard above just kept out of this file, scoped to the file's own
    // basis (U.23). The guard is the right call — the app does no FX and a converted figure
    // would be invented — but a reader whose euro account simply is not here, with nothing
    // saying so, would take this file for their complete ledger. The app already refuses
    // that silence on screen (#141 banner, #150 inline note); a file that leaves the app
    // entirely is the last place it should be allowed back in.
    const withheld = await getWithheldRegisterAccountSummary(userId);
    const txns = rawTxns.filter((t) => keepsReconciled(t.accountId, t.date));
    const csv = transactionsToCsv(
      txns.map((t) => ({
        date: t.date,
        account: accountLabel(t.account),
        rawDescriptor: t.rawDescriptor,
        merchant: t.merchant?.canonical ?? null,
        category: t.categoryId
          ? (categoryMeta.get(t.categoryId)?.name ?? t.category?.name ?? categoryName(t.categoryId))
          : null,
        amountCents: t.amountCents,
        status: t.status,
        onHandoverDay: handoverKeys.has(handoverKey(t.accountId, t.date)),
        // U.26: read straight off the row, never re-derived. Both flags are
        // stored columns that `summarizeTransactions` reads to keep a row out of
        // the register's in/out/net tiles, so anything cleverer here would be a
        // second opinion about which rows count — the H.8 divergence U.23 just
        // finished removing from this same route's where-clause.
        excludeFromTotals: t.excludeFromTotals,
        isTransfer: t.isTransfer,
      })),
      withheld,
    );
    await auditLog(userId, 'export.transactions.csv', { rows: txns.length });
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="aimplifi-transactions.csv"',
      },
    });
  }

  // Tax-year export (O.1): the reader's own tags, grouped and totalled by class.
  // The YEAR is required and never defaulted — guessing which year someone meant on a
  // file they may hand to a preparer is exactly the kind of silent assumption this app
  // does not make. The settings page offers one link per year that actually has data.
  if (format === 'tax-year-csv') {
    const rawYear = request.nextUrl.searchParams.get('year');
    const year = Number(rawYear);
    // 1900–2999 is not a tax rule, just a sane band that rejects a typo or a probe
    // before it reaches a query; the engine does plain string date comparison, so a
    // non-integer year would silently match nothing rather than fail.
    if (rawYear == null || !/^\d{4}$/.test(rawYear) || year < 1900 || year > 2999) {
      return NextResponse.json({ error: 'A four-digit `year` is required, e.g. ?year=2025' }, { status: 400 });
    }
    const report = await getTaxExport(userId, year);
    const csv = taxExportToCsv(report);
    await auditLog(userId, 'export.tax-year.csv', {
      year,
      groups: report.groups.length,
      lines: report.groups.reduce((n, g) => n + g.lines.length, 0),
    });
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${taxExportFilename(year)}"`,
      },
    });
  }

  // Net-worth/PDF exports need accounts; a brand-new user has none.
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) {
    return NextResponse.json({ error: 'Nothing to export yet — add an account first.' }, { status: 400 });
  }
  const data = await getDashboardData(userId);

  if (format === 'net-worth-csv') {
    const csv = netWorthToCsv(data.netWorthTrend);
    await auditLog(userId, 'export.net-worth.csv', { rows: data.netWorthTrend.length });
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="aimplifi-net-worth.csv"',
      },
    });
  }

  if (format === 'net-worth-pdf') {
    const pdf = await netWorthReportPdf({
      generatedFor: session?.user?.email ?? 'demo user',
      asOf: data.today,
      netWorthCents: data.netWorthCents,
      accounts: data.accounts,
      // L.20 critic cycle, finding A-1. `data.accounts` is `snap.accounts` mapped verbatim, with
      // no superseded filter, so a reconciliation predecessor reaches this report at the $0.00
      // the assembler zeroed it to — and the frozen note would then swear that $0.00 is "still
      // counted" in the totals. Resolved here rather than in `getDashboardData` because the
      // dashboard's own consumers of that payload want the unfiltered list.
      supersededAccountIds: [...(await activeSupersededPredecessorIds([userId]))],
      trend: data.netWorthTrend,
    });
    await auditLog(userId, 'export.net-worth.pdf', {});
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="aimplifi-net-worth.pdf"',
      },
    });
  }

  return NextResponse.json({ error: `Unknown format "${format}"` }, { status: 400 });
}
