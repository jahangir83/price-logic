import type {
  SetupGuideDto,
  StoreSettings,
  StoreSettingsResponse,
  UpdateStoreSettingsRequest,
  VisitableStep,
} from '@pricelogic/shared';
import { apiFetch } from './client';

export function getSettings(): Promise<StoreSettings> {
  return apiFetch<StoreSettingsResponse>('/settings').then(
    (response) => response.settings,
  );
}

export function updateSettings(
  patch: UpdateStoreSettingsRequest,
): Promise<StoreSettings> {
  return apiFetch<StoreSettingsResponse>('/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }).then((response) => response.settings);
}

export function getSetupGuide(): Promise<SetupGuideDto> {
  return apiFetch('/setup-guide');
}

/**
 * Tells the server the merchant reached a step's destination.
 *
 * Returns the whole guide rather than nothing, so the home screen is correct
 * the next time it renders without having to ask again.
 */
export function markStepSeen(step: VisitableStep): Promise<SetupGuideDto> {
  return apiFetch(`/setup-guide/steps/${step}/seen`, { method: 'POST' });
}

export function dismissSetupGuide(): Promise<SetupGuideDto> {
  return apiFetch('/setup-guide/dismiss', { method: 'POST' });
}
