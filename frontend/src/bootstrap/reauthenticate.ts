import { API_URL } from '../api/client';
import { clearInstallCache } from './installCache';
import { readShopParams } from './shopParams';
import { topNavigate } from './topNavigate';

/**
 * Sends the merchant back through OAuth.
 *
 * Called when the backend says the shop has no install left — the merchant
 * uninstalled and reinstalled, or the app was removed while a tab stayed open.
 * The session token in hand is genuine and will keep being genuine, so retrying
 * gets nowhere; the only way forward is a new install.
 *
 * The cached "installed" answer is dropped first, or the boot gate would wave
 * the merchant straight past this check on the way back.
 */
export function reauthenticate(): void {
  const { shop, host } = readShopParams();
  if (!shop) return;

  clearInstallCache();

  const params = new URLSearchParams({ shop });
  if (host) params.set('host', host);
  topNavigate(`${API_URL}/auth?${params.toString()}`);
}
