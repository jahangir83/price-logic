import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  BulkOperationKind,
  BulkOperationStatus,
  isTerminalBulkOperationStatus,
} from '@pricelogic/shared';
import { Repository } from 'typeorm';
import { ShopsService } from '../../shops/services/shops.service';
import { Shop } from '../../shops/entities/shop.entity';
import { BulkOperation } from '../entities/bulk-operation.entity';
import { ShopifyApiError } from '../shopify.errors';
import { ShopifyGraphQlClient } from '../shopify-graphql.client';

/**
 * Shopify bulk operations — the default path for reading the catalogue and for
 * writing anything of size.
 *
 * Three properties shape everything here:
 *
 * 1. **It is asynchronous.** Shopify accepts the operation and runs it on its
 *    own schedule. The caller gets an id, not an answer, so the operation is a
 *    row in `bulk_operations` and the job that started it parks.
 * 2. **It needs the offline token.** The operation and its result outlive the
 *    request that started it, so the credentials come from the shop record —
 *    the token stored at install — never from a merchant's session.
 * 3. **The result URL expires after a week.** Results are downloaded during the
 *    run. A URL recorded for later is a 403 with no way to ask for another.
 *
 * Concurrency is Shopify's, not ours: operations are tracked per app per shop,
 * with one bulk *mutation* in flight at a time. `runMutation` surfaces that
 * rejection as a typed error rather than pretending it succeeded.
 */
@Injectable()
export class BulkOperationService {
  private readonly logger = new Logger(BulkOperationService.name);

  constructor(
    private readonly client: ShopifyGraphQlClient,
    private readonly shops: ShopsService,
    @InjectRepository(BulkOperation)
    private readonly operations: Repository<BulkOperation>,
  ) {}

  private credentials(shop: Shop) {
    return {
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      // The offline token, stored at install. A bulk operation outlives the
      // request that started it, so a session token would be gone before the
      // result could be read.
      accessToken: this.shops.getDecryptedAccessToken(shop),
    };
  }

  // -------------------------------------------------------------------
  // Starting
  // -------------------------------------------------------------------

  /**
   * Start a bulk query.
   *
   * The query must contain at least one connection, may nest connections two
   * deep at most, and needs the same access scopes it would need run normally —
   * a missing scope comes back as `ACCESS_DENIED` naming no field, which is why
   * a failing query is worth running non-bulk once to find the culprit.
   */
  async runQuery(
    shop: Shop,
    query: string,
    jobId: string | null = null,
  ): Promise<BulkOperation> {
    const data = await this.client.request<{
      bulkOperationRunQuery: {
        bulkOperation: GqlBulkOperation | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    }>({
      ...this.credentials(shop),
      estimatedCost: 10,
      query: BULK_QUERY_MUTATION,
      variables: { query },
    });

    const result = data.bulkOperationRunQuery;
    assertNoUserErrors(result.userErrors, 'bulkOperationRunQuery');
    if (!result.bulkOperation) {
      throw ShopifyApiError.unavailable(
        'Shopify accepted the bulk query but returned no operation',
      );
    }

    return this.record(
      shop,
      result.bulkOperation,
      BulkOperationKind.QUERY,
      jobId,
    );
  }

  /**
   * Start a bulk mutation over a staged JSONL upload.
   *
   * `variables` is one object per mutation invocation — for a price write, one
   * per product. The caller has already chunked the set; this does not split it
   * further, because the chunk boundary decides what a retry re-runs and that
   * is the caller's decision, not the transport's.
   */
  async runMutation(
    shop: Shop,
    mutation: string,
    variables: readonly Record<string, unknown>[],
    jobId: string | null = null,
  ): Promise<BulkOperation> {
    if (variables.length === 0) {
      throw new Error('A bulk mutation needs at least one set of variables');
    }

    const stagedPath = await this.stageJsonl(
      shop,
      variables.map((entry) => JSON.stringify(entry)).join('\n'),
    );

    const data = await this.client.request<{
      bulkOperationRunMutation: {
        bulkOperation: GqlBulkOperation | null;
        userErrors: { field: string[] | null; message: string }[];
      };
    }>({
      ...this.credentials(shop),
      estimatedCost: 10,
      query: BULK_MUTATION_MUTATION,
      variables: { mutation, stagedUploadPath: stagedPath },
    });

    const result = data.bulkOperationRunMutation;
    assertNoUserErrors(result.userErrors, 'bulkOperationRunMutation');
    if (!result.bulkOperation) {
      throw ShopifyApiError.unavailable(
        'Shopify accepted the bulk mutation but returned no operation',
      );
    }

    this.logger.log(
      `Started bulk mutation ${result.bulkOperation.id} for shop ${shop.id} ` +
        `over ${variables.length} object(s)`,
    );
    return this.record(
      shop,
      result.bulkOperation,
      BulkOperationKind.MUTATION,
      jobId,
    );
  }

  /**
   * Put JSONL on Shopify's staging bucket and return the key to run it from.
   *
   * The upload is a plain multipart POST to the URL Shopify hands back, not a
   * GraphQL call — `parameters` must be appended in the order given and the
   * file last, which is why this builds the form by hand rather than from an
   * object.
   */
  private async stageJsonl(shop: Shop, jsonl: string): Promise<string> {
    const data = await this.client.request<{
      stagedUploadsCreate: {
        stagedTargets: {
          url: string;
          resourceUrl: string | null;
          parameters: { name: string; value: string }[];
        }[];
        userErrors: { field: string[] | null; message: string }[];
      };
    }>({
      ...this.credentials(shop),
      estimatedCost: 10,
      query: STAGED_UPLOADS_CREATE_MUTATION,
      variables: {
        input: [
          {
            resource: 'BULK_MUTATION_VARIABLES',
            filename: 'bulk_op_vars.jsonl',
            mimeType: 'text/jsonl',
            httpMethod: 'POST',
          },
        ],
      },
    });

    assertNoUserErrors(
      data.stagedUploadsCreate.userErrors,
      'stagedUploadsCreate',
    );
    const target = data.stagedUploadsCreate.stagedTargets[0];
    if (!target) {
      throw ShopifyApiError.unavailable(
        'Shopify returned no staged upload target',
      );
    }

    const form = new FormData();
    for (const parameter of target.parameters) {
      form.append(parameter.name, parameter.value);
    }
    // The file goes last: S3 ignores anything appended after it.
    form.append('file', new Blob([jsonl], { type: 'text/jsonl' }));

    const response = await fetch(target.url, { method: 'POST', body: form });
    if (!response.ok) {
      throw ShopifyApiError.unavailable(
        `Staged upload failed with ${response.status}`,
        response.status,
      );
    }

    const key = target.parameters.find(
      (parameter) => parameter.name === 'key',
    )?.value;
    if (!key) {
      throw ShopifyApiError.unavailable(
        'Shopify staged the upload without returning its key',
      );
    }
    return key;
  }

  private async record(
    shop: Shop,
    operation: GqlBulkOperation,
    kind: BulkOperationKind,
    jobId: string | null,
  ): Promise<BulkOperation> {
    // orUpdate rather than insert: Shopify can hand back an operation id we
    // already know if a call is retried after a timeout, and a second row would
    // give the finish webhook two candidates for the same operation.
    await this.operations
      .createQueryBuilder()
      .insert()
      .into(BulkOperation)
      .values({
        shopId: shop.id,
        jobId,
        shopifyBulkOperationId: operation.id,
        kind,
        status: toStatus(operation.status),
      })
      .orUpdate(['status', 'job_id'], ['shopify_bulk_operation_id'])
      .execute();

    return this.operations.findOneOrFail({
      where: { shopifyBulkOperationId: operation.id },
    });
  }

  // -------------------------------------------------------------------
  // Finishing
  // -------------------------------------------------------------------

  /**
   * Ask Shopify where an operation has got to and write the answer down.
   *
   * The webhook is the primary signal; this is the backstop. A webhook that
   * never arrives — dropped, or delivered while the app was down — would
   * otherwise leave a job parked indefinitely.
   */
  async refresh(shop: Shop, operation: BulkOperation): Promise<BulkOperation> {
    const data = await this.client.request<{
      node: GqlBulkOperation | null;
    }>({
      ...this.credentials(shop),
      estimatedCost: 5,
      query: BULK_OPERATION_NODE_QUERY,
      variables: { id: operation.shopifyBulkOperationId },
    });

    if (!data.node) {
      // Shopify has forgotten it. Nothing will ever finish it, so it is marked
      // expired rather than left waiting forever.
      return this.applyStatus(operation, {
        id: operation.shopifyBulkOperationId,
        status: 'EXPIRED',
      });
    }
    return this.applyStatus(operation, data.node);
  }

  /** Record a status Shopify reported, by webhook or by poll. */
  async applyStatus(
    operation: BulkOperation,
    reported: GqlBulkOperation,
  ): Promise<BulkOperation> {
    const status = toStatus(reported.status);

    await this.operations.update(
      { id: operation.id },
      {
        status,
        url: reported.url ?? operation.url,
        partialDataUrl: reported.partialDataUrl ?? operation.partialDataUrl,
        errorCode: reported.errorCode ?? null,
        objectCount: Number(reported.objectCount ?? operation.objectCount ?? 0),
        fileSize:
          reported.fileSize === null || reported.fileSize === undefined
            ? operation.fileSize
            : Number(reported.fileSize),
        completedAt: isTerminalBulkOperationStatus(status)
          ? (operation.completedAt ?? new Date())
          : null,
      },
    );

    return this.operations.findOneOrFail({ where: { id: operation.id } });
  }

  async findByShopifyId(
    shopifyBulkOperationId: string,
  ): Promise<BulkOperation | null> {
    return this.operations.findOne({ where: { shopifyBulkOperationId } });
  }

  async findById(id: string): Promise<BulkOperation | null> {
    return this.operations.findOne({ where: { id } });
  }

  /** Operations still in flight, for the poller. */
  async findUnfinished(shopId?: string): Promise<BulkOperation[]> {
    const qb = this.operations
      .createQueryBuilder('operation')
      .where('operation.status IN (:...statuses)', {
        statuses: [
          BulkOperationStatus.CREATED,
          BulkOperationStatus.RUNNING,
          BulkOperationStatus.CANCELING,
        ],
      });
    if (shopId) {
      qb.andWhere('operation.shop_id = :shopId', { shopId });
    }
    return qb.getMany();
  }

  // -------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------

  /**
   * Stream a finished operation's JSONL, one parsed object at a time.
   *
   * Streamed rather than buffered because these files are routinely hundreds of
   * megabytes — a 40,000-variant read does not fit in memory twice, and this is
   * running inside a worker that has other jobs to serve.
   *
   * Nested connections arrive flattened, with each child carrying `__parentId`.
   */
  async *readResults<T = Record<string, unknown>>(
    operation: BulkOperation,
  ): AsyncGenerator<T> {
    const url = operation.url ?? operation.partialDataUrl;
    if (!url) return;

    const response = await fetch(url);
    if (!response.ok) {
      throw ShopifyApiError.unavailable(
        // A week-old URL is the usual cause, and it cannot be reissued.
        `Bulk operation results could not be downloaded (${response.status})`,
        response.status,
      );
    }
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // The last element is whatever arrived mid-line; it waits for the rest.
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) yield JSON.parse(trimmed) as T;
      }
    }

    const remainder = buffer.trim();
    if (remainder) yield JSON.parse(remainder) as T;
  }
}

/** Shopify's shape, before it becomes a row. */
export interface GqlBulkOperation {
  id: string;
  status: string;
  errorCode?: string | null;
  objectCount?: string | number | null;
  fileSize?: string | number | null;
  url?: string | null;
  partialDataUrl?: string | null;
}

const KNOWN_STATUSES = new Set<string>(Object.values(BulkOperationStatus));

function toStatus(status: string): BulkOperationStatus {
  const upper = status.toUpperCase();
  // An unrecognised status is treated as still running rather than finished:
  // waking a job early on a status we do not understand would have it read
  // results that are not there yet.
  return KNOWN_STATUSES.has(upper)
    ? (upper as BulkOperationStatus)
    : BulkOperationStatus.RUNNING;
}

function assertNoUserErrors(
  errors: { field: string[] | null; message: string }[],
  operation: string,
): void {
  if (errors.length === 0) return;
  const message = errors.map((error) => error.message).join('; ');
  throw new ShopifyApiError(`${operation}: ${message}`, 'UNKNOWN', false);
}

const BULK_OPERATION_FIELDS = `
  id
  status
  errorCode
  createdAt
  completedAt
  objectCount
  fileSize
  url
  partialDataUrl
`;

const BULK_QUERY_MUTATION = `
  mutation bulkOperationRunQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { ${BULK_OPERATION_FIELDS} }
      userErrors { field message }
    }
  }
`;

const BULK_MUTATION_MUTATION = `
  mutation bulkOperationRunMutation($mutation: String!, $stagedUploadPath: String!) {
    bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
      bulkOperation { ${BULK_OPERATION_FIELDS} }
      userErrors { field message }
    }
  }
`;

const STAGED_UPLOADS_CREATE_MUTATION = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const BULK_OPERATION_NODE_QUERY = `
  query bulkOperationStatus($id: ID!) {
    node(id: $id) {
      ... on BulkOperation { ${BULK_OPERATION_FIELDS} }
    }
  }
`;
