import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { rateLimitDurable } from '@/server/authz';
import {
  REPORT_LIMIT,
  REPORT_WINDOW_MS,
  formatClientErrorLog,
  parseClientErrorReport,
} from '@/lib/client-error';

/**
 * POST /api/client-error (DECISIONS #794): a signed-in browser reports a
 * JavaScript error, an unhandled rejection, or a React hydration failure, and
 * the server writes ONE structured line to its log, where `vercel logs` can
 * read it. Nothing is stored. Signed-in only (the middleware already answers
 * 401 for an anonymous API call), capped per user per minute, and the body is
 * validated and clipped before it is logged.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await rateLimitDurable(`client-error:${userId}`, REPORT_LIMIT, REPORT_WINDOW_MS))) {
    return NextResponse.json({ error: 'Too many reports' }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const report = parseClientErrorReport(body);
  if (!report) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  console.error(formatClientErrorLog(userId, report));
  return new NextResponse(null, { status: 204 });
}
