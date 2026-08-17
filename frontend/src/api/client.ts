import type { ApiErrorResponse } from '@pricelogic/shared';
import { reauthenticate } from '../bootstrap/reauthenticate';
import { canUseSessionToken, getSessionToken } from './session-token';

/**
 * Origin of the backend, including its `api` prefix. Exported because the boot
 * sequence needs to build a top-frame OAuth URL, which is a navigation rather
 * than a fetch.
 *
 * Trailing slashes are stripped: every use is `${API_URL}${path}` with a path
 * that already starts with `/`, and `//store/check-installation` is a different
 * URL that no route answers.
 */
export const API_URL = ((import.meta.env.VITE_API_URL as string) ?? '').replace(
  /\/+$/,
  '',
);

/** The backend's answer when a shop has no install left to authenticate against. */
export const APP_NOT_INSTALLED = 'APP_NOT_INSTALLED';

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
 * Thin fetch wrapper for the backend API.
 *
 * ## How a request is authenticated
 *
 * Embedded — the normal case — it sends an **App Bridge session token** as
 * `Authorization: Bearer`. Inside Shopify's iframe our own cookie is a
 * third-party cookie, and every current browser partitions or blocks it; a
 * header has no such problem. The token is fetched per request because it lives
 * about a minute and App Bridge already keeps a fresh one.
 *
 * Outside the iframe there is no App Bridge, so it falls back to the session
 * cookie the OAuth callback set. `credentials: 'include'` therefore stays on
 * either way — it is what makes the fallback work, and it is harmless when a
 * token is present, because the backend prefers the header.
 *
 * Either way the shop is derived from the credential. A shop id from the client
 * is not an identity, and the backend does not accept one.
 *
 * A 401 is retried **once** with a freshly minted token: the gap between App
 * Bridge issuing a token and the backend verifying it is about a minute wide,
 * and a request that lands the wrong side of an expiry should not reach the
 * merchant as a failure. `APP_NOT_INSTALLED` is exempt — a second token would
 * be just as valid and just as unusable.
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
  let response = await send(path, options);

  if (response.status === 401 && canUseSessionToken()) {
    const failure = await readErrorBody(response);
    if (failure?.code === APP_NOT_INSTALLED) {
      // A navigation from inside a fetch wrapper is a surprising side effect,
      // and it is still the right one: there is exactly one recovery from this,
      // every caller would otherwise duplicate it, and an error toast saying
      // "not installed" leaves the merchant with nowhere to go. The error is
      // thrown as well, so callers unwind while the redirect is in flight.
      reauthenticate();
      throw new ApiError(401, failure.message ?? 'App is not installed', failure);
    }
    response = await send(path, options);
  }

  if (!response.ok) {
    const body = await readErrorBody(response);
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

/** One attempt, with whichever credential this context can produce. */
async function send(path: string, options: RequestInit): Promise<Response> {
  const token = await getSessionToken();

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  // FormData must set its own Content-Type — it carries the multipart boundary,
  // and overwriting it makes the body unparseable at the other end.
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });
}

/**
 * The error envelope, or undefined when the response is not one.
 *
 * A body can only be read once, and a 401 is read twice on the retry path —
 * once to check the code, once to build the error — so this always reads from a
 * clone.
 */
async function readErrorBody(
  response: Response,
): Promise<Partial<ApiErrorResponse> | undefined> {
  try {
    return (await response.clone().json()) as Partial<ApiErrorResponse>;
  } catch {
    return undefined;
  }
}
