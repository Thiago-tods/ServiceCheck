import * as Sentry from '@sentry/node';

/** No-op without a DSN, so local runs and tests never send anything. */
export function initSentry(dsn: string | undefined, environment: string): boolean {
  if (!dsn) return false;
  Sentry.init({ dsn, environment, tracesSampleRate: 0 });
  return true;
}
