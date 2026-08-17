import type { ResolvedPlanLimits } from '../domain/billing.js';

/**
 * Plan-limit enforcement.
 *
 * The quota is a **concurrent ceiling**, not metered usage: "variants on sale"
 * means variants affected by a campaign active right now. A merchant who runs
 * and reverts a 40-variant campaign ten times has used 40 of their quota, not
 * 400.
 *
 * The count is shop-wide and distinct. Two 30-variant campaigns exceed the
 * Free plan's 50 even though neither does alone, and a variant claimed by two
 * campaigns counts once — which is why the caller must pass a *distinct* count
 * of variants that would be on sale after this activation, not this campaign's
 * own variant count.
 */

/** The stable code the UI keys its upgrade prompt on. */
export const PLAN_LIMIT_EXCEEDED = 'PLAN_LIMIT_EXCEEDED';

export type QuotaDimension = 'VARIANTS' | 'CAMPAIGNS';

export interface QuotaViolation {
  code: typeof PLAN_LIMIT_EXCEEDED;
  dimension: QuotaDimension;
  /** The cap that applies to this shop, after overrides. */
  limit: number;
  /** What is already in use, excluding this activation. */
  current: number;
  /** What the total would become if this activation proceeded. */
  required: number;
  message: string;
}

export interface QuotaCheckInput {
  limits: ResolvedPlanLimits;
  /** Distinct variants already on sale across other active campaigns. */
  currentActiveVariants: number;
  /** Distinct variants that would be on sale *in total* after this runs. */
  requiredActiveVariants: number;
  currentActiveCampaigns: number;
  requiredActiveCampaigns: number;
}

export type QuotaCheckResult =
  | { allowed: true }
  | { allowed: false; violation: QuotaViolation };

function check(
  dimension: QuotaDimension,
  limit: number | null,
  current: number,
  required: number,
): QuotaViolation | null {
  // Null is unlimited — the Professional plan, and any shop with an override
  // explicitly set to null.
  if (limit === null || required <= limit) {
    return null;
  }
  const noun = dimension === 'VARIANTS' ? 'variants on sale' : 'active campaigns';
  return {
    code: PLAN_LIMIT_EXCEEDED,
    dimension,
    limit,
    current,
    required,
    message:
      `This would put ${required} ${noun} on your plan, which allows ${limit}.`,
  };
}

/**
 * Returns the first violation, or `{ allowed: true }`.
 *
 * Variants are checked before campaigns because that is the limit merchants
 * actually hit, and reporting one clear reason beats reporting two.
 */
export function checkPlanQuota(input: QuotaCheckInput): QuotaCheckResult {
  const violation =
    check(
      'VARIANTS',
      input.limits.activeVariantLimit,
      input.currentActiveVariants,
      input.requiredActiveVariants,
    ) ??
    check(
      'CAMPAIGNS',
      input.limits.activeCampaignLimit,
      input.currentActiveCampaigns,
      input.requiredActiveCampaigns,
    );

  return violation === null ? { allowed: true } : { allowed: false, violation };
}
