import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiErrorResponse,
  ShopifyCollectionSummary,
  ShopifyPage,
  ShopifyProductSummary,
} from '@pricelogic/shared';
import { SessionAuthGuard } from '../../../common/auth/session-auth.guard';
import { ShopGuard } from '../../../common/auth/shop.guard';
import { Shop } from '../../shops/entities/shop.entity';
import { ShopifyAdminService } from '../services/shopify-admin.service';
import { ShopifyApiError } from '../shopify.errors';

interface RequestWithShop {
  shop: Shop;
}

/**
 * Read-only catalog endpoints backing the pickers.
 *
 * The controller never touches Shopify: it holds the shop the guards resolved
 * and calls the adapter. That is the constitution's rule in code — rate
 * limiting and error translation cannot be forgotten by a caller who does not
 * have the option of calling Shopify itself.
 *
 * The shop comes from `ShopGuard`, never from a query parameter, so one
 * merchant cannot browse another's catalog by editing a URL.
 */
@Controller('catalog')
@UseGuards(SessionAuthGuard, ShopGuard)
export class CatalogController {
  constructor(private readonly shopify: ShopifyAdminService) {}

  @Get('products')
  async products(
    @Req() request: RequestWithShop,
    @Query('query') query?: string,
    @Query('after') after?: string,
    @Query('first') first?: string,
  ): Promise<ShopifyPage<ShopifyProductSummary>> {
    return this.guarded(() =>
      this.shopify.searchProducts(request.shop, {
        query,
        after: after ?? null,
        first: first ? Number(first) : undefined,
      }),
    );
  }

  @Get('collections')
  async collections(
    @Req() request: RequestWithShop,
    @Query('query') query?: string,
    @Query('after') after?: string,
    @Query('first') first?: string,
  ): Promise<ShopifyPage<ShopifyCollectionSummary>> {
    return this.guarded(() =>
      this.shopify.searchCollections(request.shop, {
        query,
        after: after ?? null,
        first: first ? Number(first) : undefined,
      }),
    );
  }

  /**
   * The three free-form facets in one call — the picker shows them as tabs and
   * filters client-side, so three round trips would only add latency.
   */
  @Get('facets')
  async facets(@Req() request: RequestWithShop): Promise<{
    tags: string[];
    vendors: string[];
    productTypes: string[];
  }> {
    return this.guarded(async () => {
      const [tags, vendors, productTypes] = await Promise.all([
        this.shopify.listTags(request.shop),
        this.shopify.listVendors(request.shop),
        this.shopify.listProductTypes(request.shop),
      ]);
      return { tags, vendors, productTypes };
    });
  }

  /**
   * Translate an adapter error into the shared `ApiErrorResponse` envelope.
   *
   * A `ShopifyApiError` already carries no payload, but it also must not
   * become a 500 — a revoked token is a 401 the UI can act on by prompting a
   * reinstall, and a throttle is a 503 worth retrying.
   */
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof ShopifyApiError)) throw error;

      const status =
        error.kind === 'UNAUTHORIZED'
          ? HttpStatus.UNAUTHORIZED
          : error.kind === 'THROTTLED' || error.kind === 'UNAVAILABLE'
            ? HttpStatus.SERVICE_UNAVAILABLE
            : HttpStatus.BAD_GATEWAY;

      const body: ApiErrorResponse = {
        statusCode: status,
        code: `SHOPIFY_${error.kind}`,
        message:
          error.kind === 'UNAUTHORIZED'
            ? 'This store’s Shopify connection needs to be re-authorised.'
            : 'Shopify could not be reached. Please try again.',
      };
      throw new HttpException(body, status);
    }
  }
}
