import { API_URL } from '../api/client';

export interface InstallationStatus {
  installed: boolean;
  /** Backend-relative path to start OAuth, e.g. `/auth?shop=…`. */
  authUrl: string | null;
}

/**
 * Asks the backend whether this shop has a usable install.
 *
 * Uses a bare `fetch` rather than `apiFetch` on purpose: this runs before a
 * session exists, so the error envelope and the credentials the shared client
 * assumes are both beside the point. A network failure answers "not installed"
 * — sending the merchant through OAuth costs them one redirect, while showing
 * them an app that cannot talk to its backend costs them a support ticket.
 */
export async function checkInstallation(
  shop: string,
  host: string | null,
): Promise<InstallationStatus> {
  const params = new URLSearchParams({ shop });
  if (host) params.set('host', host);

  try {
    const response = await fetch(
      `${API_URL}/store/check-installation?${params.toString()}`,
      { credentials: 'include' },
    );
    if (!response.ok) {
      return { installed: false, authUrl: fallbackAuthPath(params) };
    }
    return (await response.json()) as InstallationStatus;
  } catch {
    return { installed: false, authUrl: fallbackAuthPath(params) };
  }
}

/**
 * Where to send the merchant when the check itself failed.
 *
 * The backend normally supplies this, but a backend that did not answer cannot
 * supply anything — and the destination is entirely derivable from the shop we
 * already have, so there is no reason to strand the merchant.
 */
function fallbackAuthPath(params: URLSearchParams): string {
  return `/auth?${params.toString()}`;
}
