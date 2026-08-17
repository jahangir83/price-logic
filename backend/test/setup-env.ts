/**
 * Loads `.env` before any e2e suite runs.
 *
 * Suites that go through `AppModule` get this for free — Nest's ConfigModule
 * reads `.env` itself. The ones that open a raw `DataSource` to assert database
 * constraints do not, and used to fail with a bare
 * `SASL: client password must be a string` whenever the shell that ran them had
 * not exported `DATABASE_URL` by hand. Loading it here makes `npm run test:e2e`
 * work from a clean terminal, which is the only version anyone remembers.
 *
 * `override: false` so an explicitly exported variable still wins — pointing a
 * run at a different database has to stay possible.
 */
import { config } from 'dotenv';
import { join } from 'node:path';

config({ path: join(__dirname, '..', '.env'), override: false });
