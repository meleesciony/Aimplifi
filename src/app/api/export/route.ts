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
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { activeSupersededPredecessorIds, getReconciliationTxnKeep } from '@/server/reconciliation';
import { accountLabel } from '@/lib/engine/account/display-name';

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
      // Transactions = spending (bank + cards); brokerage/loan activity excluded (#62).
      where: { account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] } } },
      // Join the category so a custom category exports its real name (#111); system
      // rows are unchanged (DB name == static name), null categoryId → no category.
      include: { account: { select: { name: true, displayName: true } }, merchant: true, category: { select: { name: true } } },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    // Reconciliation boundary (slice-6 critic C-2): the exported ledger must match the
    // in-app register/reports — without this, a reconciled pair's overlap rows exported
    // both providers' copies of every real transaction. Same shared R1 rule as the register.
    const keepsReconciled = await getReconciliationTxnKeep(userId);
    const txns = rawTxns.filter((t) => keepsReconciled(t.accountId, t.date));
    const csv = transactionsToCsv(
      txns.map((t) => ({
        date: t.date,
        account: accountLabel(t.account),
        rawDescriptor: t.rawDescriptor,
        merchant: t.merchant?.canonical ?? null,
        category: t.category?.name ?? (t.categoryId ? categoryName(t.categoryId) : null),
        amountCents: t.amountCents,
        status: t.status,
      })),
    );
    await auditLog(userId, 'export.transactions.csv', { rows: txns.length });
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="aimplifi-transactions.csv"',
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
