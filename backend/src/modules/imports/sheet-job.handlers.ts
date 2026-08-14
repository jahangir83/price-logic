import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JobStep, JobType } from '@pricelogic/shared';
import { Repository } from 'typeorm';
import {
  JobHandlerRegistry,
  PermanentJobError,
  type JobContext,
} from '../jobs/job-handler';
import { Shop } from '../shops/entities/shop.entity';
import { ImportsService } from './imports.service';

/**
 * The first real job handlers.
 *
 * The engine from J2 knows how to claim, retry and finish work; it knows
 * nothing about sheets. This is where that boundary is crossed — registering a
 * handler rather than adding a branch to the dispatcher is what keeps the
 * engine free of every feature that ever uses it.
 *
 * Parsing and matching are separate job types on purpose. Parsing is local and
 * fast; matching calls Shopify and can be throttled for minutes. Splitting
 * them means a rate limit never forces a re-parse, and the merchant sees rows
 * appear before matching finishes.
 */
@Injectable()
export class SheetJobHandlers implements OnModuleInit {
  private readonly logger = new Logger(SheetJobHandlers.name);

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly imports: ImportsService,
    @InjectRepository(Shop)
    private readonly shops: Repository<Shop>,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      type: JobType.CSV_PARSE,
      run: (context) => this.parse(context),
    });
    this.registry.register({
      type: JobType.CSV_MATCH,
      run: (context) => this.match(context),
    });
  }

  private async parse(context: JobContext): Promise<void> {
    const importId = this.importIdOf(context);

    await context.advanceTo(JobStep.PARSE_FILE);
    const record = await this.imports.parse(context.job.shopId, importId);

    await context.report({
      total: record.totalRows,
      processed: record.totalRows,
    });

    if (await context.shouldStop()) return;

    // Matching is its own job so a Shopify throttle cannot force a re-parse.
    await context.spawnChildren([
      { type: JobType.CSV_MATCH, csvImportId: importId, payload: { importId } },
    ]);
  }

  private async match(context: JobContext): Promise<void> {
    const importId = this.importIdOf(context);
    const shop = await this.shops.findOne({
      where: { id: context.job.shopId },
    });
    if (!shop) {
      // The merchant uninstalled while the sheet was queued. No retry helps.
      throw new PermanentJobError(
        'The shop is no longer connected.',
        'SHOP_DISCONNECTED',
      );
    }

    await context.advanceTo(JobStep.MATCH_SKUS);
    const record = await this.imports.match(shop, importId);

    await context.report({
      total: record.totalRows,
      processed: record.matchedRows,
      failed: record.totalRows - record.matchedRows,
    });

    this.logger.log(
      `Import ${importId}: ${record.matchedRows}/${record.totalRows} rows matched`,
    );
  }

  /** A job with no import id is a bug in whatever enqueued it, not a blip. */
  private importIdOf(context: JobContext): string {
    const importId =
      context.job.csvImportId ??
      (typeof context.job.payload.importId === 'string'
        ? context.job.payload.importId
        : null);

    if (!importId) {
      throw new PermanentJobError(
        'This job has no sheet attached.',
        'MISSING_IMPORT_ID',
      );
    }
    return importId;
  }
}
