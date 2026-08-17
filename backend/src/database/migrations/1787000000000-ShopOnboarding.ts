import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where the setup guide keeps what the merchant has already done.
 *
 * Only the steps completed by going somewhere are stored. Having a first
 * campaign is derived from the campaigns table on every read, so there is
 * nothing here that can fall out of agreement with the campaigns that exist.
 *
 * Existing shops get `{}` rather than a backfill of `null` timestamps: the two
 * are read identically, and an empty object is the honest record of "we never
 * asked". A merchant who installed last week and already has campaigns will see
 * the third step complete and the first two open, which is correct — they have
 * genuinely not opened settings.
 */
export class ShopOnboarding1787000000000 implements MigrationInterface {
  name = 'ShopOnboarding1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shops"
        ADD COLUMN "onboarding" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shops" DROP COLUMN "onboarding"
    `);
  }
}
