/**
 * Next.js instrumentation hook (Gap 6 §2 / DECISIONS #189).
 * Registers `onRequestError` so unhandled server/request errors reach Sentry
 * when a DSN is set. With no DSN, captureError is a no-op — golden-safe.
 */
import type { Instrumentation } from 'next';
import { captureError } from '@/lib/errors';

export async function register() {
  // No SDK init — captureError is fetch-based and dormant without a DSN.
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // Never attach request bodies / cookies / auth headers — path + method only.
  await captureError(error, {
    boundary: 'request',
    tags: {
      routePath: request.path.slice(0, 200),
      routeType: String(context.routeType),
    },
    extra: {
      method: request.method,
    },
  });
};
