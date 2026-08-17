import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ShopifyApiError } from './shopify.errors';
import { ShopifyCost, ThrottleRegistry } from './throttle';

/**
 * The transport, injectable so tests can drive the adapter without a network.
 *
 * Deliberately shaped like `fetch` rather than wrapping an HTTP library: the
 * mock in the test suite is then a plain function, and swapping the real
 * client later changes one provider.
 */
export interface ShopifyTransport {
  (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ): Promise<ShopifyTransportResponse>;
}

export interface ShopifyTransportResponse {
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export const SHOPIFY_TRANSPORT = 'SHOPIFY_TRANSPORT';

export interface GraphQlRequest {
  shopId: string;
  shopDomain: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
  /**
   * Cost estimate used to throttle *before* sending. Shopify reports the real
   * cost afterwards; this only has to be roughly right to keep the bucket from
   * being overrun by concurrent calls.
   */
  estimatedCost?: number;
}

interface GraphQlBody<T> {
  data?: T;
  errors?: {
    message: string;
    extensions?: { code?: string };
  }[];
  extensions?: { cost?: ShopifyCost };
}

const MAX_ATTEMPTS = 4;
const DEFAULT_ESTIMATED_COST = 50;

/**
 * The single place an HTTP request is made to Shopify.
 *
 * Owns API-version pinning, throttling, retry and error translation. Nothing
 * above this layer sees a GraphQL envelope — callers get typed data or a
 * `ShopifyApiError`.
 */
@Injectable()
export class ShopifyGraphQlClient {
  private readonly logger = new Logger(ShopifyGraphQlClient.name);
  private readonly apiVersion: string;

  constructor(
    private readonly config: ConfigService,
    private readonly throttle: ThrottleRegistry,
    @Optional()
    @Inject(SHOPIFY_TRANSPORT)
    private readonly transport: ShopifyTransport = defaultTransport,
  ) {
    this.apiVersion =
      this.config.get<string>('shopify.apiVersion') ?? '2025-01';
  }

  endpointFor(shopDomain: string): string {
    return `https://${shopDomain}/admin/api/${this.apiVersion}/graphql.json`;
  }

  /**
   * Run a query, waiting for the bucket first and retrying a throttle.
   *
   * Retries only what is worth retrying: a revoked token or a malformed query
   * returns the same answer every time, and retrying it four times just delays
   * the error the merchant needs to see.
   */
  async request<T>(request: GraphQlRequest): Promise<T> {
    const cost = request.estimatedCost ?? DEFAULT_ESTIMATED_COST;
    let lastError: ShopifyApiError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await this.waitForBucket(request.shopId, cost);
      this.throttle.reserve(request.shopId, cost);

      try {
        return await this.send<T>(request);
      } catch (error) {
        if (!(error instanceof ShopifyApiError) || !error.retryable) {
          throw error;
        }
        lastError = error;
        if (attempt === MAX_ATTEMPTS) break;

        const backoffMs = 2 ** (attempt - 1) * 500;
        this.logger.warn(
          `${error.kind} from Shopify for shop ${request.shopId}; retrying in ${backoffMs}ms (attempt ${attempt}/${MAX_ATTEMPTS})`,
        );
        await sleep(backoffMs);
      }
    }

    throw (
      lastError ??
      ShopifyApiError.unavailable('Shopify request failed after retries')
    );
  }

  private async waitForBucket(shopId: string, cost: number): Promise<void> {
    const waitMs = this.throttle.waitMs(shopId, cost);
    if (waitMs > 0) {
      this.logger.debug(
        `Throttling ${waitMs}ms ahead of the limit for ${shopId}`,
      );
      await sleep(waitMs);
    }
  }

  private async send<T>(request: GraphQlRequest): Promise<T> {
    const response = await this.transport(
      this.endpointFor(request.shopDomain),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': request.accessToken,
        },
        body: JSON.stringify({
          query: request.query,
          variables: request.variables ?? {},
        }),
      },
    );

    if (response.status === 401 || response.status === 403) {
      // The merchant uninstalled or the scopes changed; no retry will fix it.
      throw ShopifyApiError.unauthorized();
    }
    if (response.status === 429) {
      throw ShopifyApiError.throttled();
    }
    if (response.status >= 500) {
      throw ShopifyApiError.unavailable(
        `Shopify returned ${response.status}`,
        response.status,
      );
    }

    let body: GraphQlBody<T> | null | undefined;
    try {
      body = (await response.json()) as GraphQlBody<T> | null | undefined;
    } catch {
      throw ShopifyApiError.unavailable(
        'Shopify returned a malformed response',
      );
    }

    // A proxy error page parses to null/undefined rather than throwing. Left
    // unguarded this reads `.extensions` off nothing and a raw TypeError
    // escapes the adapter — exactly the leak typed errors exist to prevent.
    if (body === null || body === undefined || typeof body !== 'object') {
      throw ShopifyApiError.unavailable(
        'Shopify returned a malformed response',
      );
    }

    // Record the real cost even on an error response — a throttled reply still
    // tells us how full the bucket is, which is exactly when we need to know.
    if (body.extensions?.cost?.throttleStatus) {
      this.throttle.observe(
        request.shopId,
        body.extensions.cost.throttleStatus,
      );
    }

    if (body.errors?.length) {
      throw translateErrors(body.errors);
    }
    if (body.data === undefined || body.data === null) {
      throw ShopifyApiError.unavailable('Shopify returned no data');
    }

    return body.data;
  }
}

function translateErrors(
  errors: { message: string; extensions?: { code?: string } }[],
): ShopifyApiError {
  const codes = errors
    .map((error) => error.extensions?.code)
    .filter((code): code is string => typeof code === 'string');
  const message = errors.map((error) => error.message).join('; ');

  if (codes.includes('THROTTLED')) {
    return ShopifyApiError.throttled(message);
  }
  if (
    codes.includes('ACCESS_DENIED') ||
    codes.includes('UNAUTHENTICATED') ||
    /access token/i.test(message)
  ) {
    return ShopifyApiError.unauthorized(message);
  }
  if (codes.includes('INTERNAL_SERVER_ERROR')) {
    return ShopifyApiError.unavailable(message);
  }
  return new ShopifyApiError(message, 'UNKNOWN', false, codes);
}

const defaultTransport: ShopifyTransport = async (url, init) => {
  const response = await fetch(url, init);
  return {
    status: response.status,
    json: () => response.json(),
    text: () => response.text(),
  };
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
