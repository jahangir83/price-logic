import { AppPlanHandle, resolvePlanLimits } from '../domain/billing.js';
import { PLAN_LIMIT_EXCEEDED, checkPlanQuota } from './quota.js';

const limits = (
  activeVariantLimit: number | null,
  activeCampaignLimit: number | null = null,
) => ({
  planHandle: AppPlanHandle.FREE,
  activeVariantLimit,
  activeCampaignLimit,
});

const input = (
  activeVariantLimit: number | null,
  currentActiveVariants: number,
  requiredActiveVariants: number,
) => ({
  limits: limits(activeVariantLimit),
  currentActiveVariants,
  requiredActiveVariants,
  currentActiveCampaigns: 0,
  requiredActiveCampaigns: 1,
});

describe('resolvePlanLimits', () => {
  const plan = {
    handle: AppPlanHandle.STARTER,
    activeVariantLimit: 2000,
    activeCampaignLimit: 10,
  };

  it('uses the plan limits when no override exists', () => {
    expect(resolvePlanLimits(plan)).toEqual({
      planHandle: AppPlanHandle.STARTER,
      activeVariantLimit: 2000,
      activeCampaignLimit: 10,
    });
  });

  it('lets a shop override take precedence', () => {
    expect(
      resolvePlanLimits(plan, { activeVariantLimit: 5000 }).activeVariantLimit,
    ).toBe(5000);
  });

  it('treats a null override as "use the plan default", not unlimited', () => {
    // The distinction that makes overrides safe to leave null by default.
    expect(
      resolvePlanLimits(plan, { activeVariantLimit: null }).activeVariantLimit,
    ).toBe(2000);
  });
});

describe('checkPlanQuota', () => {
  it('allows an activation that fits', () => {
    expect(checkPlanQuota(input(50, 20, 45))).toEqual({ allowed: true });
  });

  it('allows an activation that lands exactly on the limit', () => {
    expect(checkPlanQuota(input(50, 20, 50))).toEqual({ allowed: true });
  });

  it('blocks one variant over', () => {
    const result = checkPlanQuota(input(50, 20, 51));
    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error('expected a violation');
    expect(result.violation.code).toBe(PLAN_LIMIT_EXCEEDED);
    expect(result.violation.dimension).toBe('VARIANTS');
    expect(result.violation.limit).toBe(50);
    expect(result.violation.required).toBe(51);
  });

  it('reports numbers the UI can render an upgrade prompt from', () => {
    const result = checkPlanQuota(input(50, 30, 60));
    if (result.allowed) throw new Error('expected a violation');
    expect(result.violation.current).toBe(30);
    expect(result.violation.message).toContain('60');
    expect(result.violation.message).toContain('50');
  });

  it('blocks the shop-wide total, not this campaign alone', () => {
    // Two 30-variant campaigns on the Free plan: the second one passes any
    // per-campaign check and must still be rejected.
    expect(checkPlanQuota(input(50, 30, 60)).allowed).toBe(false);
  });

  it('treats a null variant limit as unlimited', () => {
    expect(checkPlanQuota(input(null, 900_000, 1_000_000))).toEqual({
      allowed: true,
    });
  });

  it('enforces the campaign limit once variants fit', () => {
    const result = checkPlanQuota({
      limits: limits(null, 1),
      currentActiveVariants: 0,
      requiredActiveVariants: 10,
      currentActiveCampaigns: 1,
      requiredActiveCampaigns: 2,
    });
    if (result.allowed) throw new Error('expected a violation');
    expect(result.violation.dimension).toBe('CAMPAIGNS');
  });

  it('reports the variant violation first when both are exceeded', () => {
    const result = checkPlanQuota({
      limits: limits(50, 1),
      currentActiveVariants: 50,
      requiredActiveVariants: 80,
      currentActiveCampaigns: 1,
      requiredActiveCampaigns: 2,
    });
    if (result.allowed) throw new Error('expected a violation');
    expect(result.violation.dimension).toBe('VARIANTS');
  });
});
