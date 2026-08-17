import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-step job results, and Shopify bulk operations.
 *
 * Two changes that only look unrelated. Both exist because work that takes
 * minutes cannot be held in a running function:
 *
 * 1. `job_step_results` makes a step a unit of work rather than a cursor. A
 *    retry re-enters at the recorded step *with* what the earlier steps
 *    produced, instead of re-resolving targets and re-reading prices — and
 *    re-reading prices after some have already been written is how a revert
 *    ends up restoring a number that was never on the storefront.
 *
 * 2. `bulk_operations` records an operation Shopify runs on its own schedule
 *    and reports back on later, possibly to a different worker and possibly
 *    after a deploy. A job parks on one (`jobs.bulk_operation_id`, status
 *    WAITING_BULK) and is woken by the `bulk_operations/finish` webhook.
 *
 * The enum rebuild rather than `ALTER TYPE … ADD VALUE` is deliberate: a value
 * added to an existing type cannot be *used* in the same transaction, and this
 * migration has to rebuild `UQ_jobs_live_dedup_key` to include the new status
 * in the same breath. A brand-new type carries no such restriction.
 */
export class JobStepResultsAndBulkOperations1787400000000 implements MigrationInterface {
  name = 'JobStepResultsAndBulkOperations1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------------
    // 1. JobStatus gains WAITING_BULK
    // ---------------------------------------------------------------

    await queryRunner.query(
      `ALTER TYPE "jobs_status_enum" RENAME TO "jobs_status_enum_old"`,
    );
    await queryRunner.query(`
      CREATE TYPE "jobs_status_enum" AS ENUM (
        'PENDING', 'BLOCKED', 'RUNNING', 'WAITING_CHILDREN', 'WAITING_BULK',
        'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED'
      )
    `);

    // Both partial indexes name the type in their predicate, so they have to
    // go before the column can be retyped.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_jobs_running_concurrency_key"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_jobs_live_dedup_key"`);

    await queryRunner.query(
      `ALTER TABLE "jobs" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(`
      ALTER TABLE "jobs"
        ALTER COLUMN "status" TYPE "jobs_status_enum"
        USING "status"::text::"jobs_status_enum"
    `);
    await queryRunner.query(
      `ALTER TABLE "jobs" ALTER COLUMN "status" SET DEFAULT 'PENDING'`,
    );
    await queryRunner.query(`DROP TYPE "jobs_status_enum_old"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_jobs_running_concurrency_key"
        ON "jobs" ("shop_id", "concurrency_key")
        WHERE "status" = 'RUNNING' AND "concurrency_key" IS NOT NULL
    `);

    /*
     * WAITING_BULK joins the live set. A job parked on a bulk operation is
     * still in flight, so it must keep holding its deduplication key —
     * otherwise a redelivered webhook or a second click enqueues a *duplicate*
     * of work Shopify is at that moment executing.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_jobs_live_dedup_key"
        ON "jobs" ("shop_id", "dedup_key")
        WHERE "dedup_key" IS NOT NULL
          AND "status" IN ('PENDING', 'BLOCKED', 'RUNNING',
                           'WAITING_CHILDREN', 'WAITING_BULK', 'PAUSED')
    `);

    // ---------------------------------------------------------------
    // 2. job_step_results
    // ---------------------------------------------------------------

    await queryRunner.query(`
      CREATE TYPE "job_step_results_step_enum" AS ENUM (
        'RESOLVE_TARGETS', 'FETCH_PRICES', 'CHECK_PLAN_LIMIT', 'CALCULATE',
        'WRITE_CHANGES', 'PUSH_PRICES', 'PUSH_TAGS', 'RESTORE_PRICES',
        'RESTORE_TAGS', 'PARSE_FILE', 'MATCH_SKUS', 'FINALIZE'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "job_step_results_status_enum" AS ENUM (
        'PENDING', 'RUNNING', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "job_step_results" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shop_id" uuid NOT NULL,
        "job_id" uuid NOT NULL,
        "step" "job_step_results_step_enum" NOT NULL,
        "status" "job_step_results_status_enum" NOT NULL DEFAULT 'PENDING',
        -- Re-entries across every attempt, not attempts of the job.
        "tries" integer NOT NULL DEFAULT 0,
        "result" jsonb,
        "error_message" text,
        "started_at" TIMESTAMP WITH TIME ZONE,
        "finished_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_job_step_results" PRIMARY KEY ("id"),
        -- One row per step, rewritten in place: "what did RESOLVE_TARGETS
        -- produce?" must have exactly one answer.
        CONSTRAINT "UQ_job_step_results_job_step" UNIQUE ("job_id", "step")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_job_step_results_shop" ON "job_step_results" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_step_results_shop_job" ON "job_step_results" ("shop_id", "job_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "job_step_results"
        ADD CONSTRAINT "FK_job_step_results_shop"
        FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT
    `);
    // Composite, so a step result cannot be attached to another tenant's job.
    await queryRunner.query(`
      ALTER TABLE "job_step_results"
        ADD CONSTRAINT "FK_job_step_results_job_shop"
        FOREIGN KEY ("shop_id", "job_id")
        REFERENCES "jobs"("shop_id", "id") ON DELETE CASCADE
    `);

    // ---------------------------------------------------------------
    // 3. bulk_operations
    // ---------------------------------------------------------------

    await queryRunner.query(
      `CREATE TYPE "bulk_operations_kind_enum" AS ENUM ('QUERY', 'MUTATION')`,
    );
    await queryRunner.query(`
      CREATE TYPE "bulk_operations_status_enum" AS ENUM (
        'CREATED', 'RUNNING', 'COMPLETED', 'FAILED',
        'CANCELING', 'CANCELED', 'EXPIRED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "bulk_operations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shop_id" uuid NOT NULL,
        -- Nullable: an operation started outside a job, and an operation whose
        -- job has been removed, both still need their record.
        "job_id" uuid,
        "shopify_bulk_operation_id" character varying NOT NULL,
        "kind" "bulk_operations_kind_enum" NOT NULL,
        "status" "bulk_operations_status_enum" NOT NULL DEFAULT 'CREATED',
        -- Signed, and expires one week after completion. Kept for diagnosis,
        -- never as a plan for later work.
        "url" text,
        "partial_data_url" text,
        "error_code" character varying,
        "object_count" integer NOT NULL DEFAULT 0,
        "file_size" bigint,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bulk_operations" PRIMARY KEY ("id"),
        -- The finish webhook identifies an operation by this id alone, and a
        -- redelivery must find the same row rather than insert a second.
        CONSTRAINT "UQ_bulk_operations_shopify_id"
          UNIQUE ("shopify_bulk_operation_id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_bulk_operations_shop" ON "bulk_operations" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bulk_operations_shop_status" ON "bulk_operations" ("shop_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bulk_operations_job" ON "bulk_operations" ("job_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "bulk_operations"
        ADD CONSTRAINT "FK_bulk_operations_shop"
        FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE "bulk_operations"
        ADD CONSTRAINT "FK_bulk_operations_job_shop"
        FOREIGN KEY ("shop_id", "job_id")
        REFERENCES "jobs"("shop_id", "id") ON DELETE CASCADE
    `);

    // ---------------------------------------------------------------
    // 4. jobs.bulk_operation_id
    // ---------------------------------------------------------------

    await queryRunner.query(
      `ALTER TABLE "jobs" ADD COLUMN "bulk_operation_id" uuid`,
    );
    // SET NULL, not CASCADE: losing the operation record must never delete the
    // job that was waiting on it.
    await queryRunner.query(`
      ALTER TABLE "jobs"
        ADD CONSTRAINT "FK_jobs_bulk_operation"
        FOREIGN KEY ("bulk_operation_id")
        REFERENCES "bulk_operations"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_jobs_bulk_operation" ON "jobs" ("bulk_operation_id")
        WHERE "bulk_operation_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_jobs_bulk_operation"`);
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP CONSTRAINT IF EXISTS "FK_jobs_bulk_operation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "jobs" DROP COLUMN IF EXISTS "bulk_operation_id"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "bulk_operations" CASCADE`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "bulk_operations_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "bulk_operations_kind_enum"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "job_step_results" CASCADE`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "job_step_results_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "job_step_results_step_enum"`);

    /*
     * Any job actually parked on a bulk operation has to go somewhere the old
     * enum can express. PENDING is the honest choice: the operation record is
     * being dropped above, so the job has nothing left to wait for and the
     * dispatcher should pick it up again.
     */
    await queryRunner.query(
      `UPDATE "jobs" SET "status" = 'PENDING' WHERE "status" = 'WAITING_BULK'`,
    );

    await queryRunner.query(
      `ALTER TYPE "jobs_status_enum" RENAME TO "jobs_status_enum_new"`,
    );
    await queryRunner.query(`
      CREATE TYPE "jobs_status_enum" AS ENUM (
        'PENDING', 'BLOCKED', 'RUNNING', 'WAITING_CHILDREN',
        'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED'
      )
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_jobs_running_concurrency_key"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_jobs_live_dedup_key"`);

    await queryRunner.query(
      `ALTER TABLE "jobs" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(`
      ALTER TABLE "jobs"
        ALTER COLUMN "status" TYPE "jobs_status_enum"
        USING "status"::text::"jobs_status_enum"
    `);
    await queryRunner.query(
      `ALTER TABLE "jobs" ALTER COLUMN "status" SET DEFAULT 'PENDING'`,
    );
    await queryRunner.query(`DROP TYPE "jobs_status_enum_new"`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_jobs_running_concurrency_key"
        ON "jobs" ("shop_id", "concurrency_key")
        WHERE "status" = 'RUNNING' AND "concurrency_key" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_jobs_live_dedup_key"
        ON "jobs" ("shop_id", "dedup_key")
        WHERE "dedup_key" IS NOT NULL
          AND "status" IN ('PENDING', 'BLOCKED', 'RUNNING',
                           'WAITING_CHILDREN', 'PAUSED')
    `);
  }
}
