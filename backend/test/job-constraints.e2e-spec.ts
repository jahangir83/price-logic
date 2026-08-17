import { DataSource } from 'typeorm';

/**
 * Proves the job and billing constraints at the database level.
 *
 * These are the rules the application is *not* trusted to keep. Concurrency 1
 * per shop is what stops a campaign being applied twice and what makes the
 * plan-limit check race-free; if it lived only in a service method, one
 * forgotten transaction boundary would silently undo both guarantees. So the
 * tests here drive raw SQL — the point is that the database refuses, not that
 * some TypeScript refused first.
 */
describe('job execution constraints', () => {
  let dataSource: DataSource;

  const SHOP_A = 'eeeeeeee-0000-4000-8000-00000000000e';
  const SHOP_B = 'ffffffff-0000-4000-8000-00000000000f';

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      synchronize: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await cleanup();
      await dataSource.destroy();
    }
  });

  const cleanup = async () => {
    await dataSource.query(
      `DELETE FROM job_dependencies WHERE shop_id IN ($1, $2)`,
      [SHOP_A, SHOP_B],
    );
    await dataSource.query(
      `DELETE FROM job_executions WHERE shop_id IN ($1,$2)`,
      [SHOP_A, SHOP_B],
    );
    await dataSource.query(`DELETE FROM jobs WHERE shop_id IN ($1, $2)`, [
      SHOP_A,
      SHOP_B,
    ]);
    await dataSource.query(`DELETE FROM shops WHERE id IN ($1, $2)`, [
      SHOP_A,
      SHOP_B,
    ]);
  };

  beforeEach(async () => {
    await cleanup();
    await dataSource.query(
      `INSERT INTO shops (id, shopify_shop_id, shop_domain, access_token_encrypted)
       VALUES ($1, 'job-a', 'job-a.myshopify.com', 'ciphertext'),
              ($2, 'job-b', 'job-b.myshopify.com', 'ciphertext')`,
      [SHOP_A, SHOP_B],
    );
  });

  const insertJob = (
    shopId: string,
    overrides: {
      status?: string;
      concurrencyKey?: string | null;
      dedupKey?: string | null;
      id?: string;
    } = {},
  ) =>
    dataSource.query(
      `INSERT INTO jobs (id, shop_id, type, status, concurrency_key, dedup_key)
       VALUES (COALESCE($1::uuid, uuid_generate_v4()), $2, 'CAMPAIGN_ACTIVATE', $3, $4, $5)
       RETURNING id`,
      [
        overrides.id ?? null,
        shopId,
        overrides.status ?? 'PENDING',
        overrides.concurrencyKey ?? null,
        overrides.dedupKey ?? null,
      ],
    );

  describe('concurrency', () => {
    it('refuses a second RUNNING job for the same shop and key', async () => {
      await insertJob(SHOP_A, {
        status: 'RUNNING',
        concurrencyKey: 'campaign-exec',
      });
      await expect(
        insertJob(SHOP_A, {
          status: 'RUNNING',
          concurrencyKey: 'campaign-exec',
        }),
      ).rejects.toThrow(/UQ_jobs_running_concurrency_key/);
    });

    it('lets a different shop run its own campaign at the same time', async () => {
      // Concurrency is per shop. One merchant must never block another.
      await insertJob(SHOP_A, {
        status: 'RUNNING',
        concurrencyKey: 'campaign-exec',
      });
      await expect(
        insertJob(SHOP_B, {
          status: 'RUNNING',
          concurrencyKey: 'campaign-exec',
        }),
      ).resolves.toBeDefined();
    });

    it('allows many queued jobs for the same key — only RUNNING is limited', async () => {
      await insertJob(SHOP_A, {
        status: 'PENDING',
        concurrencyKey: 'campaign-exec',
      });
      await expect(
        insertJob(SHOP_A, {
          status: 'PENDING',
          concurrencyKey: 'campaign-exec',
        }),
      ).resolves.toBeDefined();
    });

    it('frees the key once the running job finishes', async () => {
      const [{ id }] = (await insertJob(SHOP_A, {
        status: 'RUNNING',
        concurrencyKey: 'campaign-exec',
      })) as [{ id: string }];
      await dataSource.query(
        `UPDATE jobs SET status = 'SUCCEEDED' WHERE id = $1`,
        [id],
      );
      await expect(
        insertJob(SHOP_A, {
          status: 'RUNNING',
          concurrencyKey: 'campaign-exec',
        }),
      ).resolves.toBeDefined();
    });

    it('does not constrain jobs that declare no key', async () => {
      await insertJob(SHOP_A, { status: 'RUNNING', concurrencyKey: null });
      await expect(
        insertJob(SHOP_A, { status: 'RUNNING', concurrencyKey: null }),
      ).resolves.toBeDefined();
    });
  });

  describe('deduplication', () => {
    it('collapses a repeated request while the first is still live', async () => {
      await insertJob(SHOP_A, { dedupKey: 'activate:campaign-7' });
      await expect(
        insertJob(SHOP_A, { dedupKey: 'activate:campaign-7' }),
      ).rejects.toThrow(/UQ_jobs_live_dedup_key/);
    });

    it('allows the same work again once the first job is terminal', async () => {
      // A dedup key is not a permanent lock — the merchant may legitimately
      // activate the same campaign again tomorrow.
      const [{ id }] = (await insertJob(SHOP_A, {
        dedupKey: 'activate:campaign-7',
      })) as [{ id: string }];
      await dataSource.query(
        `UPDATE jobs SET status = 'FAILED' WHERE id = $1`,
        [id],
      );
      await expect(
        insertJob(SHOP_A, { dedupKey: 'activate:campaign-7' }),
      ).resolves.toBeDefined();
    });
  });

  describe('dependency graph', () => {
    it('is navigable in both directions', async () => {
      const [{ id: first }] = (await insertJob(SHOP_A)) as [{ id: string }];
      const [{ id: second }] = (await insertJob(SHOP_A)) as [{ id: string }];
      await dataSource.query(
        `INSERT INTO job_dependencies (shop_id, job_id, depends_on_job_id)
         VALUES ($1, $2, $3)`,
        [SHOP_A, second, first],
      );

      const waitingFor: unknown[] = await dataSource.query(
        `SELECT depends_on_job_id FROM job_dependencies WHERE job_id = $1`,
        [second],
      );
      const released: unknown[] = await dataSource.query(
        `SELECT job_id FROM job_dependencies WHERE depends_on_job_id = $1`,
        [first],
      );
      expect(waitingFor).toHaveLength(1);
      expect(released).toHaveLength(1);
    });

    it('refuses a job that depends on itself', async () => {
      const [{ id }] = (await insertJob(SHOP_A)) as [{ id: string }];
      await expect(
        dataSource.query(
          `INSERT INTO job_dependencies (shop_id, job_id, depends_on_job_id)
           VALUES ($1, $2, $2)`,
          [SHOP_A, id],
        ),
      ).rejects.toThrow(/CHK_job_dependencies_no_self/);
    });

    it('refuses a dependency that crosses shops', async () => {
      const [{ id: mine }] = (await insertJob(SHOP_A)) as [{ id: string }];
      const [{ id: theirs }] = (await insertJob(SHOP_B)) as [{ id: string }];
      await expect(
        dataSource.query(
          `INSERT INTO job_dependencies (shop_id, job_id, depends_on_job_id)
           VALUES ($1, $2, $3)`,
          [SHOP_A, mine, theirs],
        ),
      ).rejects.toThrow(/FK_job_dependencies_depends_on_shop/);
    });
  });

  describe('executions', () => {
    it('refuses two rows for the same attempt number', async () => {
      const [{ id }] = (await insertJob(SHOP_A)) as [{ id: string }];
      const insertExecution = () =>
        dataSource.query(
          `INSERT INTO job_executions (shop_id, job_id, attempt, step)
           VALUES ($1, $2, 1, 'RESOLVE_TARGETS')`,
          [SHOP_A, id],
        );
      await insertExecution();
      await expect(insertExecution()).rejects.toThrow(
        /UQ_job_executions_job_attempt/,
      );
    });

    it('keeps every attempt, so a retry does not erase what the last one did', async () => {
      const [{ id }] = (await insertJob(SHOP_A)) as [{ id: string }];
      await dataSource.query(
        `INSERT INTO job_executions (shop_id, job_id, attempt, step, status, obsolete)
         VALUES ($1, $2, 1, 'PUSH_PRICES', 'FAILED', true),
                ($1, $2, 2, 'RESOLVE_TARGETS', 'RUNNING', false)`,
        [SHOP_A, id],
      );
      const rows: unknown[] = await dataSource.query(
        `SELECT attempt FROM job_executions WHERE job_id = $1 ORDER BY attempt`,
        [id],
      );
      expect(rows).toHaveLength(2);
    });
  });

  describe('job subject', () => {
    it('refuses a job that claims both a campaign and an import', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO jobs (shop_id, type, campaign_id, csv_import_id)
           VALUES ($1, 'CAMPAIGN_ACTIVATE', uuid_generate_v4(), uuid_generate_v4())`,
          [SHOP_A],
        ),
      ).rejects.toThrow(/CHK_jobs_single_subject/);
    });
  });
});

describe('billing constraints', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      synchronize: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('seeds the four plans with the advertised limits', async () => {
    const rows: { handle: string; active_variant_limit: number | null }[] =
      await dataSource.query(
        `SELECT handle, active_variant_limit FROM app_plans ORDER BY sort_order`,
      );
    expect(rows.map((r) => [r.handle, r.active_variant_limit])).toEqual([
      ['FREE', 50],
      ['STARTER', 2000],
      ['PLUS', 20000],
      // Null is unlimited — the distinction the quota check depends on.
      ['PROFESSIONAL', null],
    ]);
  });

  it('refuses a duplicate plan handle', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO app_plans (handle, name) VALUES ('FREE', 'Free again')`,
      ),
    ).rejects.toThrow(/UQ_app_plans_handle/);
  });

  it('refuses a negative limit', async () => {
    await expect(
      dataSource.query(
        `INSERT INTO app_plans (handle, name, active_variant_limit)
         VALUES ('STARTER', 'Bad', -1)`,
      ),
    ).rejects.toThrow(/CHK_app_plans_limits_non_negative/);
  });
});
