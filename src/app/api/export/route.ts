/**
 * Data export (Phase 4): /api/export?format=transactions-csv|net-worth-csv|net-worth-pdf
 * Auth required; every export is audit-logged; rate-limited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { auditLog, rateLimit } from '@/server/authz';
import { getDashboardData } from '@/server/finance';
import { netWorthReportPdf, netWorthToCsv, transactionsToCsv } from '@/lib/export';
import { categoryName } from '@/lib/engine/categorize/categories';

export async function GET(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`export:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many export requests' }, { status: 429 });
  }

  const format = request.nextUrl.searchParams.get('format') ?? 'transactions-csv';

  if (format === 'transactions-csv') {
    const txns = await prisma.transaction.findMany({
      where: { account: { userId } },
      include: { account: { select: { name: true } }, merchant: true },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    const csv = transactionsToCsv(
      txns.map((t) => ({
        date: t.date,
        account: t.account.name,
        rawDescriptor: t.rawDescriptor,
        merchant: t.merchant?.canonical ?? null,
        category: t.categoryId ? categoryName(t.categoryId) : null,
        amountCents: t.amountCents,
        status: t.status,
      })),
    );
    await auditLog(userId, 'export.transactions.csv', { rows: txns.length });
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="pulse-transactions.csv"',
      },
    });
  }

  // Net-worth/PDF exports need accounts; a brand-new user has none.
  if ((await prisma.account.count({ where: { userId } })) === 0) {
    return NextResponse.json({ error: 'Nothing to export yet — add an account first.' }, { status: 400 });
  }
  const data = await getDashboardData(userId);

  if (format === 'net-worth-csv') {
    const csv = netWorthToCsv(data.netWorthTrend);
    await auditLog(userId, 'export.net-worth.csv', { rows: data.netWorthTrend.length });
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="pulse-net-worth.csv"',
      },
    });
  }

  if (format === 'net-worth-pdf') {
    const pdf = await netWorthReportPdf({
      generatedFor: session?.user?.email ?? 'demo user',
      asOf: data.today,
      netWorthCents: data.netWorthCents,
      accounts: data.accounts,
      trend: data.netWorthTrend,
    });
    await auditLog(userId, 'export.net-worth.pdf', {});
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="pulse-net-worth.pdf"',
      },
    });
  }

  return NextResponse.json({ error: `Unknown format "${format}"` }, { status: 400 });
}
