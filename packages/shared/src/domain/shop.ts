import type { DuplicatePolicy } from './campaign.js';
import type { Serialized } from '../serialization.js';

export enum ShopStatus {
  ACTIVE = 'ACTIVE',
  DISCONNECTED = 'DISCONNECTED',
  SUSPENDED = 'SUSPENDED',
}

export enum InitializationStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETE = 'COMPLETE',
}

/**
 * The tenant root. Every merchant-owned table carries a `shopId` back to here.
 *
 * `accessTokenEncrypted` is deliberately absent from this model — it is
 * AES-256-GCM ciphertext that never leaves the backend, and a shared model is
 * a shape the admin UI can import. Keeping it out means it cannot be
 * serialized into a response by accident.
 */
export interface Shop {
  id: string;
  shopifyShopId: string;
  shopDomain: string;
  currency: string;
  timezone: string;
  status: ShopStatus;
  initializationStatus: InitializationStatus;
  defaultSettings: Record<string, unknown>;

  /**
   * The merchant's global setting for a variant claimed by two campaigns. A
   * campaign may override it; null on the campaign means "use this".
   */
  duplicatePolicy: DuplicatePolicy;

  /**
   * Per-shop plan-limit overrides. Null means "use the plan's own limit" —
   * *not* unlimited. These exist so an enterprise deal, a support gesture or a
   * grandfathered merchant does not require a deploy.
   */
  overrideActiveVariantLimit: number | null;
  overrideActiveCampaignLimit: number | null;

  createdAt: Date;
  updatedAt: Date;
}

export type ShopDto = Serialized<Shop>;
