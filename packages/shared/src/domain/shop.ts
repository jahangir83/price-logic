import type { DuplicatePolicy } from './campaign.js';
import type { ShopOnboarding, StoreSettings } from './store-settings.js';
import type { Serialized } from '../serialization.js';

export enum ShopStatus {
  ACTIVE = 'ACTIVE',
  DISCONNECTED = 'DISCONNECTED',
  SUSPENDED = 'SUSPENDED',
}

/**
 * Whether this shop has been prepared for use — which since setup became
 * optional means one thing only: does it have its default settings yet.
 *
 * It used to mean "has the merchant finished the setup wizard". There is no
 * wizard to finish now, and a column keeping a name from a flow that no longer
 * exists is how a schema stops being readable.
 */
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

  /**
   * Partial rather than complete, because that is what the column can actually
   * hold: it is jsonb, and every shop installed before defaults were seeded has
   * `{}` in it. Reads fill the gaps from `DEFAULT_STORE_SETTINGS` and write the
   * result back, so a row converges on being complete — but the type must not
   * claim it already is.
   */
  defaultSettings: Partial<StoreSettings>;

  /** What the merchant has done of what the setup guide suggests. */
  onboarding: ShopOnboarding;

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
