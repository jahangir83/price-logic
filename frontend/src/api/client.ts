import type { ApiErrorResponse } from '@pricelogic/shared';

const API_URL = import.meta.env.VITE_API_URL as string;

export class ApiError extends Error {
  status: number;
  /** Stable machine-readable code from the backend, e.g. `CAMPAIGN_ALREADY_ACTIVE`. */
  code: string;
  /** Per-field validation messages, keyed by field name. */
  fieldErrors: Record<string, string[]>;

  constructor(status: number, message: string, body?: Partial<ApiErrorResponse>) {
    super(message);
    this.status = status;
    this.code = body?.code ?? 'UNKNOWN';
    this.fieldErrors = body?.fieldErrors ?? {};
  }
}

/**
 * Thin fetch wrapper for the backend API. Always sends the session cookie
 * (`credentials: 'include'`) — the backend never accepts a shop id from the
 * client, so there is nothing else to authenticate a request with.
 *
 * Failures are parsed as the `ApiErrorResponse` envelope from
 * `@pricelogic/shared`, so a form can read `fieldErrors` without every caller
 * re-guessing the backend's error shape. A response that is not that shape
 * (a proxy 502, an HTML error page) still yields a usable ApiError.
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    let body: Partial<ApiErrorResponse> | undefined;
    try {
      body = (await response.json()) as Partial<ApiErrorResponse>;
    } catch {
      body = undefined;
    }
    throw new ApiError(
      response.status,
      body?.message ?? `Request to ${path} failed`,
      body,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
