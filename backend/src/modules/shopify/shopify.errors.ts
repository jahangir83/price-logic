/**
 * Typed failures from the Shopify adapter.
 *
 * The constitution requires that a raw GraphQL payload never reaches a
 * controller: callers must be able to branch on *what went wrong* without
 * parsing Shopify's error shape, and a leaked payload can carry the shop
 * domain and query text into a client response.
 */

export type ShopifyErrorKind =
  /** Token rejected or revoked — the merchant must reinstall. */
  | 'UNAUTHORIZED'
  /** Rate limited despite throttling ahead; retryable. */
  | 'THROTTLED'
  /** Shopify said no for a domain reason, e.g. an invalid id. */
  | 'USER_ERROR'
  /** 5xx, timeout, socket failure; retryable. */
  | 'UNAVAILABLE'
  /** A GraphQL error we do not recognise. */
  | 'UNKNOWN';

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    readonly kind: ShopifyErrorKind,
    readonly retryable: boolean,
    /** Shopify's own error codes, for logs — never for control flow. */
    readonly codes: string[] = [],
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ShopifyApiError';
  }

  static unauthorized(message = 'Shopify rejected the access token') {
    return new ShopifyApiError(message, 'UNAUTHORIZED', false, [], 401);
  }

  static throttled(message = 'Shopify throttled the request') {
    return new ShopifyApiError(message, 'THROTTLED', true, ['THROTTLED'], 429);
  }

  static unavailable(message: string, statusCode?: number) {
    return new ShopifyApiError(message, 'UNAVAILABLE', true, [], statusCode);
  }

  static userError(message: string, codes: string[] = []) {
    return new ShopifyApiError(message, 'USER_ERROR', false, codes);
  }
}
