import { apiFetch } from './client';

export type InitializationStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE';

/**
 * What the app needs before it can render anything.
 *
 * Settings used to live here too. They moved to `/settings` when the setup
 * wizard was retired — this answers "what is this shop", not "what has the
 * merchant chosen".
 */
export interface StoreInitStatus {
  initializationStatus: InitializationStatus;
  /** The shop's own currency — the only authority on how to format money here. */
  currency: string;
}

export function getStoreInitStatus(): Promise<StoreInitStatus> {
  return apiFetch<StoreInitStatus>('/store-init/status');
}
