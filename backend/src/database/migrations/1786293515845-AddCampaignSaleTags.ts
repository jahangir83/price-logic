import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds campaign "sale tags": tags the campaign applies to (or strips from)
 * its in-scope products while running, and undoes on deactivation.
 *
 * Split into config and effect deliberately:
 *
 * - `campaign_tag_rules` is the merchant's configuration — which tags to
 *   ADD and which to REMOVE.
 * - `campaign_tag_applications` records the mutations actually performed,
 *   one row per (product, tag). Deactivation reverses exactly these rows,
 *   so a product that already carried a tag the campaign wanted to ADD is
 *   left untouched. Configuration alone can't support that: it can't
 *   distinguish a tag the campaign added from one the merchant set months
 *   ago, and blind removal would destroy merchant data.
 *
 * The partial unique index keeps re-activation idempotent — only one
 * un-reverted application per (campaign, product, tag, action) can exist,
 * while a recurring campaign that runs again after deactivation writes a
 * fresh row rather than colliding with the reverted one.
 *
 * `UQ_campaigns_shop_id` is added here because `campaigns` had no
 * `(shop_id, id)` unique constraint yet — nothing referenced campaigns
 * before, and it's the prerequisite for the composite tenant-consistency
 * foreign keys these two tables use.
 *
 * Hand-written, not raw `migration:generate` output — see the constitution;
 * the generated version also proposed dropping 25 existing constraints that
 * aren't visible to TypeORM's entity-metadata diff.
 */
export class AddCampaignSaleTags1786293515845 implements MigrationInterface {
  name = 'AddCampaignSaleTags1786293515845';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaigns" ADD CONSTRAINT "UQ_campaigns_shop_id" UNIQUE ("id", "shop_id")`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."campaign_tag_rules_action_enum" AS ENUM('ADD', 'REMOVE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "campaign_tag_rules" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "campaign_id" uuid NOT NULL, "action" "public"."campaign_tag_rules_action_enum" NOT NULL, "tag" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_da0d0cb79533158a6846c5f26f1" UNIQUE ("campaign_id", "action", "tag"), CONSTRAINT "PK_ac65d92ba575c4b62bddc3a4624" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9c467c214700e3ca2c2a5604c8" ON "campaign_tag_rules" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0cfae07d37b7d5525b9c0df162" ON "campaign_tag_rules" ("shop_id", "campaign_id")`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."campaign_tag_applications_action_enum" AS ENUM('ADD', 'REMOVE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "campaign_tag_applications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "shop_id" uuid NOT NULL, "campaign_id" uuid NOT NULL, "product_id" uuid NOT NULL, "tag" character varying NOT NULL, "action" "public"."campaign_tag_applications_action_enum" NOT NULL, "applied_at" TIMESTAMP WITH TIME ZONE NOT NULL, "reverted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_8344a8a404f91c4468cf2d13dea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b0ac50e3d6ae821f14f54663c5" ON "campaign_tag_applications" ("shop_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c76b8bbd4e9356078c3ae662c5" ON "campaign_tag_applications" ("shop_id", "product_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_39bfd91a3d3f1e9fcd82a70cc5" ON "campaign_tag_applications" ("shop_id", "campaign_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f06ff3d78546aa9ac644ee3cdf" ON "campaign_tag_applications" ("campaign_id", "product_id", "tag", "action") WHERE "reverted_at" IS NULL`,
    );

    // Tenant consistency. CASCADE for the config rows (they are owned by the
    // campaign and carry no history); RESTRICT for the application log,
    // which is evidence of what was done to a product and follows the same
    // rule as price_history.
    await queryRunner.query(
      `ALTER TABLE "campaign_tag_rules" ADD CONSTRAINT "FK_campaign_tag_rules_shop" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_tag_rules" ADD CONSTRAINT "FK_campaign_tag_rules_campaign_shop" FOREIGN KEY ("shop_id", "campaign_id") REFERENCES "campaigns"("shop_id","id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_tag_applications" ADD CONSTRAINT "FK_campaign_tag_applications_shop" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_tag_applications" ADD CONSTRAINT "FK_campaign_tag_applications_campaign_shop" FOREIGN KEY ("shop_id", "campaign_id") REFERENCES "campaigns"("shop_id","id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_tag_applications" ADD CONSTRAINT "FK_campaign_tag_applications_product_shop" FOREIGN KEY ("shop_id", "product_id") REFERENCES "products"("shop_id","id") ON DELETE RESTRICT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "campaign_tag_applications" DROP CONSTRAINT "FK_campaign_tag_applications_product_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_tag_applications" DROP CONSTRAINT "FK_campaign_tag_applications_campaign_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_tag_applications" DROP CONSTRAINT "FK_campaign_tag_applications_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_tag_rules" DROP CONSTRAINT "FK_campaign_tag_rules_campaign_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "campaign_tag_rules" DROP CONSTRAINT "FK_campaign_tag_rules_shop"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_f06ff3d78546aa9ac644ee3cdf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_39bfd91a3d3f1e9fcd82a70cc5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c76b8bbd4e9356078c3ae662c5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b0ac50e3d6ae821f14f54663c5"`,
    );
    await queryRunner.query(`DROP TABLE "campaign_tag_applications"`);
    await queryRunner.query(
      `DROP TYPE "public"."campaign_tag_applications_action_enum"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_0cfae07d37b7d5525b9c0df162"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9c467c214700e3ca2c2a5604c8"`,
    );
    await queryRunner.query(`DROP TABLE "campaign_tag_rules"`);
    await queryRunner.query(
      `DROP TYPE "public"."campaign_tag_rules_action_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "campaigns" DROP CONSTRAINT "UQ_campaigns_shop_id"`,
    );
  }
}
