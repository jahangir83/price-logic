export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  shopify: {
    apiKey: string;
    clientSecret: string;
    scopes: string;
    /**
     * The **backend's** public origin, including the global `api` prefix.
     *
     * Despite the Shopify-flavoured name, every URL built from it is a route
     * this server answers: the OAuth callback, the webhook endpoints and the
     * billing return. It is *not* the app's `application_url` — that is the
     * frontend, and lives in `frontendUrl`.
     */
    appUrl: string;
    apiVersion: string;
  };
  session: {
    secret: string;
    ttlDays: number;
  };
  encryptionKey: string;
  frontendUrl: string;
  uploads: {
    /**
     * Where supplier sheets are written. Outside the web root by default —
     * the file is merchant data and must not be fetchable by guessing a URL.
     */
    dir: string;
  };
  scheduler: {
    /** 'false' keeps the sweep dormant — used by the test suite. */
    enabled: string;
    intervalMs: number;
    /**
     * How late a campaign may start after downtime before it is abandoned.
     * Deactivation has no equivalent — a campaign past its end is always
     * reverted, however late.
     */
    activationGraceMs: number;
  };
  jobs: {
    /** 'false' keeps the dispatcher dormant — used by the test suite. */
    dispatcherEnabled: string;
    pollIntervalMs: number;
    /** Jobs one worker process runs at once. */
    concurrency: number;
    /** A RUNNING job untouched for this long is treated as an orphan. */
    staleLockMs: number;
  };
}

/**
 * An origin with any trailing slashes removed.
 *
 * Both URLs below are only ever used as a prefix — `${appUrl}/auth/callback`,
 * or an exact-match CORS origin. A trailing slash breaks both, and breaks them
 * quietly: the redirect URI stops matching the one registered with Shopify, and
 * the CORS check fails because a browser's `Origin` header never has one.
 */
const origin = (value: string | undefined): string =>
  (value ?? '').replace(/\/+$/, '');

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL as string,
  shopify: {
    apiKey: process.env.SHOPIFY_API_KEY as string,
    clientSecret: process.env.SHOPIFY_CLIENT_SECRET as string,
    scopes: process.env.SHOPIFY_SCOPES as string,
    appUrl: origin(process.env.SHOPIFY_APP_URL),
    apiVersion: process.env.SHOPIFY_API_VERSION ?? '2026-07',
  },
  session: {
    secret: process.env.SESSION_SECRET as string,
    ttlDays: parseInt(process.env.SESSION_TTL_DAYS ?? '7', 10),
  },
  encryptionKey: process.env.ENCRYPTION_KEY as string,
  frontendUrl: origin(process.env.FRONTEND_URL),
  uploads: {
    dir: process.env.UPLOADS_DIR ?? `${process.cwd()}/../uploads`,
  },
  scheduler: {
    enabled: process.env.SCHEDULER_ENABLED ?? 'true',
    intervalMs: parseInt(process.env.SCHEDULER_INTERVAL_MS ?? '30000', 10),
    activationGraceMs: parseInt(
      process.env.SCHEDULER_ACTIVATION_GRACE_MS ?? '3600000',
      10,
    ),
  },
  jobs: {
    dispatcherEnabled: process.env.JOBS_DISPATCHER_ENABLED ?? 'true',
    pollIntervalMs: parseInt(process.env.JOBS_POLL_INTERVAL_MS ?? '1000', 10),
    concurrency: parseInt(process.env.JOBS_CONCURRENCY ?? '2', 10),
    staleLockMs: parseInt(process.env.JOBS_STALE_LOCK_MS ?? '300000', 10),
  },
});
