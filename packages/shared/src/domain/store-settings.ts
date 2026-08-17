/**
 * The merchant's shop-wide pricing defaults, and the onboarding state that
 * decides what the setup guide still suggests doing.
 *
 * ## What these settings currently do
 *
 * They are stored, shown and edited. **They are not yet enforced** — no code
 * path reads them before calculating or applying a price. That is written down
 * here rather than left to be discovered, because a value named
 * `minimumPrice` reads like a guardrail, and treating it as one while nothing
 * checks it is exactly the mistake this note exists to prevent. Enforcing them
 * means changing money-affecting code and is deliberately a separate change.
 */

/** How a price is derived from its base, when the merchant does not say. */
export enum PricingStrategy {
  PERCENTAGE_MARKUP = 'PERCENTAGE_MARKUP',
  FIXED_MARKUP = 'FIXED_MARKUP',
  TARGET_MARGIN = 'TARGET_MARGIN',
}

export interface StoreSettings {
  defaultPricingStrategy: PricingStrategy;
  /** Floor on margin, as a percentage. */
  minimumMarginPercent: number;
  /**
   * Floor on the price itself, in the shop's currency, as a decimal string.
   * A string for the same reason every other money value in this codebase is
   * one: a float cannot hold `0.10` and money arithmetic on one is wrong in
   * ways that only show up in aggregate.
   */
  minimumPrice: string;
  /** Ceiling on the price, or null for none. */
  maximumPrice: string | null;

  /**
   * Leave a variant alone when it is out of stock.
   *
   * On by default: repricing something nobody can buy is at best wasted, and a
   * campaign that promotes it is worse. Off is a real choice though — a
   * merchant restocking next week may want the sale price already set when the
   * stock lands.
   */
  skipOutOfStock: boolean;
}

/**
 * What a shop starts with.
 *
 * The floors are deliberately the weakest ones that still mean something. A
 * default that blocks legitimate campaigns teaches merchants to turn the
 * protections off, and a protection that is off is worth less than one set
 * loosely — so `minimumMarginPercent` is 0 and there is no maximum.
 *
 * `minimumPrice` is the exception at one cent, because it guards a specific
 * arithmetic accident rather than a commercial choice: a percentage discount
 * applied to a low price rounds to zero, and a product priced at zero is not a
 * discounted product but a free one.
 */
export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  defaultPricingStrategy: PricingStrategy.PERCENTAGE_MARKUP,
  minimumMarginPercent: 0,
  minimumPrice: '0.01',
  maximumPrice: null,
  skipOutOfStock: true,
};

/**
 * Fills a partially-stored settings object from the defaults.
 *
 * The one place the merge rule lives. Both the settings screen and the pricing
 * paths need a complete object out of a column that may hold `{}`, and two
 * copies of "what a missing minimum price means" is two chances to disagree
 * about a number that decides whether a price is written.
 */
export function resolveStoreSettings(
  stored: Partial<StoreSettings> | null | undefined,
): StoreSettings {
  return { ...DEFAULT_STORE_SETTINGS, ...(stored ?? {}) };
}

/** Why a variant is being left alone, when it is. */
export enum StockSkipReason {
  /** The supplier's own sheet says they have none. */
  SUPPLIER = 'SUPPLIER',
  /** Shopify says the shop has none. */
  SHOP = 'SHOP',
}

/**
 * Whether this row should be left alone for want of stock, and which side is
 * out.
 *
 * One function so the review screen and the activation cannot disagree about
 * what will happen — a preview that promises an update the run then skips is
 * the failure the approval screen exists to prevent.
 *
 * **Unknown is not zero.** A sheet with no stock column, and a variant whose
 * inventory Shopify does not track, both arrive as null. Reading that as "none"
 * would silently stop repricing every untracked product in the store, which is
 * most of them in plenty of shops.
 */
export function stockSkipReason(
  stock: { supplier?: number | null; shop?: number | null },
  settings: Pick<StoreSettings, 'skipOutOfStock'>,
): StockSkipReason | null {
  if (!settings.skipOutOfStock) return null;

  // The supplier is checked first because it is the more actionable answer:
  // "they cannot send it" is a different problem from "you have run out".
  if (typeof stock.supplier === 'number' && stock.supplier <= 0) {
    return StockSkipReason.SUPPLIER;
  }
  if (typeof stock.shop === 'number' && stock.shop <= 0) {
    return StockSkipReason.SHOP;
  }
  return null;
}

/**
 * When the merchant did each thing the setup guide suggests.
 *
 * Timestamps rather than booleans: "when did this shop first open settings" is
 * a question worth being able to answer, and it costs nothing over a flag that
 * can only say yes.
 *
 * Creating the first campaign is **not** here. It is derived from the campaigns
 * table on every read, because a stored flag can disagree with the table, and
 * when it does the merchant is left to work out which one is lying.
 */
export interface ShopOnboarding {
  settingsVisitedAt: string | null;
  faqVisitedAt: string | null;
  /** Set when the merchant hides the guide. Never unset by the app. */
  dismissedAt: string | null;
}

export const EMPTY_ONBOARDING: ShopOnboarding = {
  settingsVisitedAt: null,
  faqVisitedAt: null,
  dismissedAt: null,
};

/** The steps, in the order the guide shows them. */
export enum SetupStep {
  SETTINGS = 'SETTINGS',
  FAQ = 'FAQ',
  FIRST_CAMPAIGN = 'FIRST_CAMPAIGN',
}

/** The two steps a merchant completes by going somewhere. */
export const VISITABLE_STEPS = [SetupStep.SETTINGS, SetupStep.FAQ] as const;
export type VisitableStep = (typeof VISITABLE_STEPS)[number];

export function isVisitableStep(value: string): value is VisitableStep {
  return (VISITABLE_STEPS as readonly string[]).includes(value);
}
