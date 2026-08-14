import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Webhook idempotency.
 *
 * Shopify redelivers aggressively — any non-2xx, any timeout, and periodically
 * on its own schedule. Without a record of what has already been handled, a
 * redelivered `app/uninstalled` can disconnect a shop that has since
 * reinstalled, and a redelivered `shop/redact` re-runs a deletion.
 *
 * The unique index on Shopify's own delivery id is the whole mechanism: a
 * second delivery collides, the insert is ignored, and the handler returns 200
 * without doing the work twice.
 */
export class WebhookDeliveries1786950000000 implements MigrationInterface {
  name = 'WebhookDeliveries1786950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "webhook_deliveries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        -- Shopify's X-Shopify-Webhook-Id. Unique per delivery, stable across
        -- retries of the same delivery.
        "webhook_id" character varying NOT NULL,
        "topic" character varying NOT NULL,
        "shop_domain" character varying NOT NULL,
        -- Nullable: a redact for a shop we have already deleted still arrives,
        -- and must still be recorded as handled.
        "shop_id" uuid,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "processed_at" TIMESTAMP WITH TIME ZONE,
        "error_message" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_webhook_deliveries_webhook_id" UNIQUE ("webhook_id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_deliveries_shop" ON "webhook_deliveries" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_deliveries_topic_time" ON "webhook_deliveries" ("topic", "created_at")`,
    );

    // SET NULL rather than CASCADE: shop/redact deletes the shop, and the
    // record that we handled that webhook has to outlive it.
    await queryRunner.query(`
      ALTER TABLE "webhook_deliveries"
        ADD CONSTRAINT "FK_webhook_deliveries_shop"
        FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "webhook_deliveries" CASCADE`,
    );
  }
}
