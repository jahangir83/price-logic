import { apiFetch } from './client';

export type InitializationStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';

export interface DefaultSettings {
  defaultPricingStrategy?:
    'PERCENTAGE_MARKUP' | 'FIXED_MARKUP' | 'TARGET_MARGIN';
  minimumMarginPercent?: number;
  minimumPrice?: number;
  maximumPrice?: number;
}

export interface StoreInitStatus {
  initializationStatus: InitializationStatus;
  defaultSettings: DefaultSettings;
}

export function getStoreInitStatus(): Promise<StoreInitStatus> {
  return apiFetch<StoreInitStatus>('/store-init/status');
}

export function updateDefaultSettings(
  settings: DefaultSettings,
): Promise<{ defaultSettings: DefaultSettings }> {
  return apiFetch('/store-init/settings', {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}

export function completeStoreSetup(): Promise<{
  initializationStatus: InitializationStatus;
}> {
  return apiFetch('/store-init/complete', { method: 'POST' });
}
