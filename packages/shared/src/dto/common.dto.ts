/**
 * Envelopes every endpoint shares. Kept deliberately thin — these describe the
 * wire, not the domain.
 */

/** Offset pagination, for our own tables. Shopify's cursor paging is separate. */
export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 250;

/**
 * The error body every failing endpoint returns, so the admin UI has one
 * shape to render. `fieldErrors` is populated by validation failures.
 */
export interface ApiErrorResponse {
  statusCode: number;
  /** Stable machine-readable code, e.g. `CAMPAIGN_ALREADY_ACTIVE`. */
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
}
