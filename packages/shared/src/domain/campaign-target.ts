import type { Serialized } from '../serialization.js';

export enum CampaignTargetMode {
  INCLUDE = 'INCLUDE',
  EXCLUDE = 'EXCLUDE',
}

export enum CampaignTargetType {
  PRODUCT = 'PRODUCT',
  COLLECTION = 'COLLECTION',
  VARIANT = 'VARIANT',
  TAG = 'TAG',
  VENDOR = 'VENDOR',
  PRODUCT_TYPE = 'PRODUCT_TYPE',
}

/**
 * One include or exclude target of a campaign.
 *
 * Targeting is a set, not a single scope: a campaign either covers all
 * products or a list of INCLUDE targets, and independently carries any number
 * of EXCLUDE targets. A variant is in scope when it matches the include side
 * and matches no EXCLUDE row — **exclusions always win.**
 */
export interface CampaignTarget {
  id: string;
  shopId: string;
  campaignId: string;
  mode: CampaignTargetMode;
  targetType: CampaignTargetType;
  /**
   * A Shopify id for PRODUCT / VARIANT / COLLECTION, or the literal value for
   * TAG, VENDOR and PRODUCT_TYPE.
   */
  targetValue: string;
  createdAt: Date;
}

export type CampaignTargetDto = Serialized<CampaignTarget>;

/**
 * The target types whose `targetValue` is a Shopify GID rather than a
 * free-form merchant string. Validation differs between the two groups.
 */
export const GID_TARGET_TYPES: readonly CampaignTargetType[] = [
  CampaignTargetType.PRODUCT,
  CampaignTargetType.VARIANT,
  CampaignTargetType.COLLECTION,
];
