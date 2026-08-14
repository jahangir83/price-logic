import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CampaignPriceSource,
  CampaignStatus,
  CsvImportStatus,
  CsvRowStatus,
  DEFAULT_PAGE_SIZE,
  JobType,
  calculatePrice,
  isMoney,
  toCampaignAdjustment,
  type Money,
  type PaginatedResponse,
} from '@pricelogic/shared';
import { DataSource, Repository } from 'typeorm';
import { Campaign } from '../campaigns/entities/campaign.entity';
import { JobsService } from '../jobs/jobs.service';
import { ShopifyAdminService } from '../shopify/shopify-admin.service';
import { Shop } from '../shops/entities/shop.entity';
import { parseSheet } from './csv-parser';
import { CsvImport } from './entities/csv-import.entity';
import { CsvRow } from './entities/csv-row.entity';

/** The slice of a multipart upload we use. Typed here to avoid @types/multer. */
export interface UploadedSheet {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export const MAX_SHEET_BYTES = 10 * 1024 * 1024;

const ACCEPTED_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

/**
 * Uploading, parsing and approving a supplier sheet.
 *
 * The sheet carries **final prices, not costs** — there is no margin
 * calculation anywhere in this file. `sheet_price` is the base, and the
 * campaign's own adjustment applies on top of it, which is what lets a
 * merchant take a supplier's list and add their markup.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);
  private readonly uploadDir: string;

  constructor(
    @InjectRepository(CsvImport)
    private readonly imports: Repository<CsvImport>,
    @InjectRepository(CsvRow)
    private readonly rows: Repository<CsvRow>,
    @InjectRepository(Campaign)
    private readonly campaigns: Repository<Campaign>,
    private readonly shopify: ShopifyAdminService,
    private readonly jobs: JobsService,
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    // Outside the web root by default. The file is merchant data and nothing
    // should be able to fetch it by guessing a URL.
    this.uploadDir =
      config.get<string>('uploads.dir') ?? join(process.cwd(), '..', 'uploads');
  }

  // -------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------

  /**
   * Store the file, create the import row, and hand parsing to a job.
   *
   * Returns immediately with the import id: a 30,000-row sheet takes long
   * enough to parse that holding the request open would time out behind most
   * proxies, and the merchant needs somewhere to watch progress anyway.
   */
  async upload(
    shop: Shop,
    supplierId: string,
    file: UploadedSheet,
  ): Promise<CsvImport> {
    if (file.size > MAX_SHEET_BYTES) {
      throw new BadRequestException(
        `That file is ${Math.round(file.size / 1024 / 1024)}MB. The limit is ${MAX_SHEET_BYTES / 1024 / 1024}MB.`,
      );
    }
    if (!ACCEPTED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Upload a CSV file. Export it from your spreadsheet as “CSV” first.',
      );
    }

    const record = await this.imports.save(
      this.imports.create({
        shopId: shop.id,
        supplierId,
        fileName: file.originalname,
        status: CsvImportStatus.UPLOADED,
      }),
    );

    await this.storeFile(shop.id, record.id, file.buffer);

    // Parsing is a job so it retries, reports progress and cannot be lost to a
    // dropped connection.
    await this.jobs.enqueue(shop.id, {
      type: JobType.CSV_PARSE,
      csvImportId: record.id,
      dedupKey: `csv-parse:${record.id}`,
      payload: { importId: record.id },
    });

    return record;
  }

  private pathFor(shopId: string, importId: string): string {
    // Namespaced by shop so one merchant's directory listing can never contain
    // another's file, whatever goes wrong above.
    return join(this.uploadDir, shopId, `${importId}.csv`);
  }

  private async storeFile(
    shopId: string,
    importId: string,
    buffer: Buffer,
  ): Promise<void> {
    await mkdir(join(this.uploadDir, shopId), { recursive: true });
    await writeFile(this.pathFor(shopId, importId), buffer);
  }

  // -------------------------------------------------------------------
  // Parse
  // -------------------------------------------------------------------

  /**
   * Read the stored file into `csv_rows`.
   *
   * Every row gets its own verdict; a bad line never fails the file. The one
   * exception is a missing SKU or price *column*, which means this is not a
   * supplier sheet at all.
   */
  async parse(shopId: string, importId: string): Promise<CsvImport> {
    await this.findImport(shopId, importId);
    await this.imports.update(
      { id: importId },
      { status: CsvImportStatus.PARSING },
    );

    let content: string;
    try {
      content = await readFile(this.pathFor(shopId, importId), 'utf8');
    } catch {
      return this.failImport(importId, 'The uploaded file could not be read.');
    }

    const sheet = parseSheet(content);
    if (sheet.fatalError) {
      return this.failImport(importId, sheet.fatalError);
    }

    // Re-parsing must not double the rows — the unique index on
    // (csv_import_id, row_number) would reject it anyway, loudly.
    await this.rows.delete({ shopId, csvImportId: importId });

    const entities = sheet.rows.map((row) =>
      this.rows.create({
        shopId,
        csvImportId: importId,
        rowNumber: row.rowNumber,
        rawData: row.raw,
        sku: row.sku,
        sheetPrice: row.price,
        sheetCompareAtPrice: row.compareAtPrice,
        status: row.error ? CsvRowStatus.INVALID : CsvRowStatus.VALID,
        errorMessage: row.error,
      }),
    );

    // Chunked so a large sheet does not build one enormous statement.
    await this.rows.save(entities, { chunk: 500 });

    const invalid = entities.filter(
      (row) => row.status === CsvRowStatus.INVALID,
    ).length;

    await this.imports.update(
      { id: importId },
      {
        status: CsvImportStatus.READY,
        totalRows: entities.length,
        validRows: entities.length - invalid,
        invalidRows: invalid,
        errorMessage: null,
      },
    );

    this.logger.log(
      `Parsed import ${importId}: ${entities.length} rows, ${invalid} invalid`,
    );
    return this.findImport(shopId, importId);
  }

  // -------------------------------------------------------------------
  // Match
  // -------------------------------------------------------------------

  /**
   * Resolve each valid row's SKU to a Shopify variant and fill `current_price`.
   *
   * A SKU matching more than one variant is **flagged, never guessed**. Two
   * products sharing a SKU is a merchant data problem, and repricing whichever
   * Shopify happened to return first is precisely the invisible wrong answer
   * this approval screen exists to prevent.
   */
  async match(shop: Shop, importId: string): Promise<CsvImport> {
    const rows = await this.rows.find({
      where: {
        shopId: shop.id,
        csvImportId: importId,
        status: CsvRowStatus.VALID,
      },
    });
    if (rows.length === 0) {
      await this.recount(shop.id, importId);
      return this.findImport(shop.id, importId);
    }

    const matches = await this.shopify.findVariantsBySku(
      shop,
      rows.map((row) => row.sku).filter((sku): sku is string => Boolean(sku)),
    );
    const bySku = new Map(matches.map((match) => [match.sku, match.variants]));

    const campaign = await this.campaigns.findOne({
      where: { shopId: shop.id, csvImportId: importId },
    });

    for (const row of rows) {
      const found = row.sku ? (bySku.get(row.sku) ?? []) : [];

      if (found.length === 0) {
        row.status = CsvRowStatus.UNMATCHED;
        row.errorMessage = 'No product in this store has that SKU.';
      } else if (found.length > 1) {
        row.status = CsvRowStatus.UNMATCHED;
        row.errorMessage = `${found.length} products share that SKU, so it is not clear which to update.`;
      } else {
        const variant = found[0];
        row.status = CsvRowStatus.MATCHED;
        row.errorMessage = null;
        row.shopifyVariantId = variant.variantId;
        row.shopifyProductId = variant.productId;
        row.currentPrice = variant.price;
        row.currency = shop.currency;
        row.approvedPrice = this.computeApprovedPrice(row, campaign);
      }
    }

    await this.rows.save(rows, { chunk: 500 });
    await this.recount(shop.id, importId);
    return this.findImport(shop.id, importId);
  }

  /**
   * Pre-fill what the row becomes: the sheet price with the campaign's
   * adjustment and rounding applied.
   *
   * Runs the same `calculatePrice` as everything else, so an approval screen
   * cannot show a number the activation would not produce. With no campaign
   * yet — the usual case at match time — the sheet price stands as-is.
   */
  private computeApprovedPrice(
    row: CsvRow,
    campaign: Campaign | null,
  ): Money | null {
    if (!row.sheetPrice) return null;
    if (!campaign) return row.sheetPrice;

    const result = calculatePrice({
      currentPrice: row.currentPrice ?? row.sheetPrice,
      currentCompareAtPrice: row.sheetCompareAtPrice,
      basePrice: row.sheetPrice,
      adjustment: toCampaignAdjustment(campaign),
      roundTo: campaign.roundTo,
      roundStrategy: campaign.roundStrategy,
      setCompareAt: campaign.setCompareAt,
    });
    return result.newPrice;
  }

  private async recount(shopId: string, importId: string): Promise<void> {
    const [counts] = await this.dataSource.query<
      { total: string; invalid: string; matched: string }[]
    >(
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE status = 'INVALID')::text AS invalid,
              count(*) FILTER (WHERE status = 'MATCHED')::text AS matched
         FROM csv_rows WHERE shop_id = $1 AND csv_import_id = $2`,
      [shopId, importId],
    );

    await this.imports.update(
      { id: importId },
      {
        totalRows: Number(counts?.total ?? 0),
        invalidRows: Number(counts?.invalid ?? 0),
        matchedRows: Number(counts?.matched ?? 0),
        validRows: Number(counts?.total ?? 0) - Number(counts?.invalid ?? 0),
      },
    );
  }

  // -------------------------------------------------------------------
  // Review
  // -------------------------------------------------------------------

  async findImport(shopId: string, id: string): Promise<CsvImport> {
    const record = await this.imports.findOne({ where: { shopId, id } });
    if (!record) throw new NotFoundException('Import not found');
    return record;
  }

  async listRows(
    shopId: string,
    importId: string,
    query: {
      status?: CsvRowStatus;
      problemsOnly?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ): Promise<PaginatedResponse<CsvRow>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const builder = this.rows
      .createQueryBuilder('row')
      .where('row.shop_id = :shopId AND row.csv_import_id = :importId', {
        shopId,
        importId,
      });

    if (query.status) {
      builder.andWhere('row.status = :status', { status: query.status });
    } else if (query.problemsOnly) {
      // The filter that matters: the merchant reviews what needs attention
      // first, not 4,000 rows that matched cleanly.
      builder.andWhere('row.status IN (:...statuses)', {
        statuses: [CsvRowStatus.INVALID, CsvRowStatus.UNMATCHED],
      });
    }

    const [items, totalItems] = await builder
      .orderBy('row.row_number', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      items,
      page,
      pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
    };
  }

  /**
   * A merchant's override of one row's price.
   *
   * Stored verbatim, but only after the server confirms it is a positive
   * decimal that fits `numeric(19,4)` — the constitution forbids trusting a
   * client-supplied price, and "verbatim" means "as typed", not "unchecked".
   */
  async overrideRow(
    shopId: string,
    importId: string,
    rowId: string,
    changes: { approvedPrice?: string; excluded?: boolean },
  ): Promise<CsvRow> {
    const row = await this.rows.findOne({
      where: { shopId, csvImportId: importId, id: rowId },
    });
    if (!row) throw new NotFoundException('Row not found');

    if (changes.approvedPrice !== undefined) {
      const value = changes.approvedPrice.trim();
      if (!isMoney(value)) {
        throw new BadRequestException(
          'The price must be a number with up to four decimal places.',
        );
      }
      if (Number(value) <= 0) {
        throw new BadRequestException('The price must be greater than zero.');
      }
      row.approvedPrice = value;
    }

    if (changes.excluded !== undefined) {
      row.excluded = changes.excluded;
    }

    return this.rows.save(row);
  }

  // -------------------------------------------------------------------
  // Approve
  // -------------------------------------------------------------------

  /**
   * Approving creates the campaign that owns everything downstream.
   *
   * Idempotent: approving twice returns the campaign the first approval made.
   * The check and the write share a transaction, and the job's dedup key
   * covers the case where two requests arrive at once — a merchant
   * double-clicking must not end up with two campaigns repricing the same
   * products.
   */
  async approve(
    shop: Shop,
    importId: string,
    options: { title?: string; activateNow?: boolean } = {},
  ): Promise<Campaign> {
    return this.dataSource.transaction(async (manager) => {
      const record = await manager.findOne(CsvImport, {
        where: { shopId: shop.id, id: importId },
      });
      if (!record) throw new NotFoundException('Import not found');

      const existing = await manager.findOne(Campaign, {
        where: { shopId: shop.id, csvImportId: importId },
      });
      if (existing) return existing;

      const applicable = await manager.count(CsvRow, {
        where: {
          shopId: shop.id,
          csvImportId: importId,
          status: CsvRowStatus.MATCHED,
          excluded: false,
        },
      });
      if (applicable === 0) {
        throw new ConflictException(
          'No rows in this sheet matched a product, so there is nothing to apply.',
        );
      }

      const campaign = await manager.save(
        manager.create(Campaign, {
          shopId: shop.id,
          title: options.title?.trim() || `${record.fileName}`,
          status: CampaignStatus.DRAFT,
          priceSource: CampaignPriceSource.SHEET,
          csvImportId: importId,
        }),
      );

      await manager.update(
        CsvImport,
        { id: importId },
        { status: CsvImportStatus.APPROVED, completedAt: new Date() },
      );

      this.logger.log(
        `Import ${importId} approved into campaign ${campaign.id} (${applicable} rows)`,
      );
      return campaign;
    });
  }

  private async failImport(
    importId: string,
    message: string,
  ): Promise<CsvImport> {
    await this.imports.update(
      { id: importId },
      { status: CsvImportStatus.FAILED, errorMessage: message },
    );
    return this.imports.findOneOrFail({ where: { id: importId } });
  }
}
