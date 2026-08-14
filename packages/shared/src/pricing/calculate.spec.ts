import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignBasis,
  CampaignPriceSource,
} from '../domain/campaign.js';
import { calculatePrice, resolveBasePrice, shouldApply } from './calculate.js';

const fixedDecrease = (value: string) => ({
  unit: CampaignAdjustmentUnit.FIXED_AMOUNT,
  direction: CampaignAdjustmentDirection.DECREASE,
  value,
});

const percentDecrease = (value: string) => ({
  unit: CampaignAdjustmentUnit.PERCENTAGE,
  direction: CampaignAdjustmentDirection.DECREASE,
  value,
});

const fixedIncrease = (value: string) => ({
  unit: CampaignAdjustmentUnit.FIXED_AMOUNT,
  direction: CampaignAdjustmentDirection.INCREASE,
  value,
});

describe('resolveBasePrice', () => {
  it('uses the live price for an ordinary campaign', () => {
    expect(
      resolveBasePrice({
        priceSource: CampaignPriceSource.SHOPIFY_CURRENT,
        basis: CampaignBasis.PRICE,
        currentPrice: '24.99',
        currentCompareAtPrice: '39.99',
      }),
    ).toBe('24.99');
  });

  it('uses compare-at when the campaign is based on it', () => {
    expect(
      resolveBasePrice({
        priceSource: CampaignPriceSource.SHOPIFY_CURRENT,
        basis: CampaignBasis.COMPARE_AT_PRICE,
        currentPrice: '24.99',
        currentCompareAtPrice: '39.99',
      }),
    ).toBe('39.99');
  });

  it('returns null when the compare-at basis has nothing to work from', () => {
    expect(
      resolveBasePrice({
        priceSource: CampaignPriceSource.SHOPIFY_CURRENT,
        basis: CampaignBasis.COMPARE_AT_PRICE,
        currentPrice: '24.99',
        currentCompareAtPrice: null,
      }),
    ).toBeNull();
  });

  it('ignores basis entirely for a supplier sheet', () => {
    expect(
      resolveBasePrice({
        priceSource: CampaignPriceSource.SHEET,
        basis: CampaignBasis.COMPARE_AT_PRICE,
        currentPrice: '24.99',
        currentCompareAtPrice: '39.99',
        sheetPrice: '18.50',
      }),
    ).toBe('18.50');
  });
});

describe('calculatePrice', () => {
  it('applies a percentage decrease', () => {
    const result = calculatePrice({
      currentPrice: '100.00',
      basePrice: '100.00',
      adjustment: percentDecrease('20'),
    });
    expect(result.newPrice).toBe('80.0000');
    expect(result.changed).toBe(true);
    expect(result.outcome).toBe('CHANGED');
  });

  it('applies a fixed increase', () => {
    expect(
      calculatePrice({
        currentPrice: '19.99',
        basePrice: '19.99',
        adjustment: fixedIncrease('5'),
      }).newPrice,
    ).toBe('24.9900');
  });

  it('passes the base price through untouched with no adjustment', () => {
    // A plain supplier sheet: the supplier's price is the answer.
    const result = calculatePrice({
      currentPrice: '24.99',
      basePrice: '18.50',
      adjustment: null,
    });
    expect(result.newPrice).toBe('18.5000');
    expect(result.changed).toBe(true);
  });

  it('layers the merchant markup on top of a supplier sheet price', () => {
    // The case that motivated dropping campaignType: sheet + own markup.
    expect(
      calculatePrice({
        currentPrice: '24.99',
        basePrice: '18.50',
        adjustment: {
          unit: CampaignAdjustmentUnit.PERCENTAGE,
          direction: CampaignAdjustmentDirection.INCREASE,
          value: '15',
        },
      }).newPrice,
    ).toBe('21.2750');
  });

  it('reports UNCHANGED when the maths lands on the current price', () => {
    const result = calculatePrice({
      currentPrice: '100.00',
      basePrice: '100.00',
      adjustment: percentDecrease('0'),
    });
    expect(result.changed).toBe(false);
    expect(result.outcome).toBe('UNCHANGED');
  });

  it('rounds onto the campaign price ending', () => {
    expect(
      calculatePrice({
        currentPrice: '13.00',
        basePrice: '13.00',
        adjustment: percentDecrease('21.54'),
        roundTo: '0.99',
      }).newPrice,
    ).toBe('10.9900');
  });

  it('floors at zero rather than sending Shopify a negative price', () => {
    const result = calculatePrice({
      currentPrice: '10.00',
      basePrice: '10.00',
      adjustment: percentDecrease('150'),
    });
    expect(result.newPrice).toBe('0.0000');
    expect(result.outcome).toBe('FLOORED');
  });

  it('honours a merchant floor above zero', () => {
    const result = calculatePrice({
      currentPrice: '10.00',
      basePrice: '10.00',
      adjustment: percentDecrease('90'),
      minPrice: '4.99',
    });
    expect(result.newPrice).toBe('4.9900');
    expect(result.outcome).toBe('FLOORED');
  });

  it('does not let rounding push a floored price back up', () => {
    const result = calculatePrice({
      currentPrice: '10.00',
      basePrice: '10.00',
      adjustment: percentDecrease('99'),
      roundTo: '0.99',
      minPrice: '5.00',
    });
    expect(result.newPrice).toBe('5.0000');
  });

  it('moves the old price into compare-at for the strikethrough', () => {
    const result = calculatePrice({
      currentPrice: '100.00',
      currentCompareAtPrice: null,
      basePrice: '100.00',
      adjustment: percentDecrease('20'),
      setCompareAt: true,
    });
    expect(result.newPrice).toBe('80.0000');
    expect(result.newCompareAtPrice).toBe('100.0000');
  });

  it('overwrites an existing compare-at when the price drops further', () => {
    // Already on sale at 100 (was 150); a new 20% campaign strikes 100 out.
    const result = calculatePrice({
      currentPrice: '100.00',
      currentCompareAtPrice: '150.00',
      basePrice: '100.00',
      adjustment: percentDecrease('20'),
      setCompareAt: true,
    });
    expect(result.newCompareAtPrice).toBe('100.0000');
  });

  it('refuses to write a compare-at that is not a genuine saving', () => {
    // A price increase with setCompareAt would otherwise strike out a number
    // lower than what the customer pays.
    const result = calculatePrice({
      currentPrice: '100.00',
      currentCompareAtPrice: null,
      basePrice: '100.00',
      adjustment: fixedIncrease('10'),
      setCompareAt: true,
    });
    expect(result.newPrice).toBe('110.0000');
    expect(result.newCompareAtPrice).toBeNull();
  });

  it('leaves compare-at alone when the campaign does not ask for it', () => {
    const result = calculatePrice({
      currentPrice: '100.00',
      currentCompareAtPrice: '150.00',
      basePrice: '100.00',
      adjustment: percentDecrease('20'),
      setCompareAt: false,
    });
    expect(result.newCompareAtPrice).toBe('150.0000');
  });

  it('rejects a price that is not exact decimal money', () => {
    expect(() =>
      calculatePrice({ currentPrice: '10.000001', basePrice: '10' }),
    ).toThrow(/currentPrice/);
  });

  it('is pure — the same input always gives the same answer', () => {
    const input = {
      currentPrice: '19.99',
      basePrice: '19.99',
      adjustment: percentDecrease('33.333'),
      roundTo: '0.95',
      setCompareAt: true,
    };
    expect(calculatePrice(input)).toEqual(calculatePrice(input));
  });
});

/*
 * The cases the phase brief names explicitly. The constitution requires full
 * coverage here — this is the highest-risk component in the app, and every
 * assertion below compares exact decimal strings rather than numbers, because
 * a float comparison would pass on a value Shopify then rejects.
 */
describe('calculatePrice — full matrix', () => {
  const at = (
    currentPrice: string,
    adjustment: { unit: CampaignAdjustmentUnit; direction: CampaignAdjustmentDirection; value: string } | null,
    extra: Record<string, unknown> = {},
  ) =>
    calculatePrice({
      currentPrice,
      basePrice: currentPrice,
      adjustment,
      ...extra,
    });

  describe('every unit and direction', () => {
    it('percentage increase', () => {
      expect(at('100.00', { unit: CampaignAdjustmentUnit.PERCENTAGE, direction: CampaignAdjustmentDirection.INCREASE, value: '15' }).newPrice).toBe('115.0000');
    });
    it('percentage decrease', () => {
      expect(at('100.00', percentDecrease('15')).newPrice).toBe('85.0000');
    });
    it('fixed increase', () => {
      expect(at('100.00', fixedIncrease('15')).newPrice).toBe('115.0000');
    });
    it('fixed decrease', () => {
      expect(at('100.00', { unit: CampaignAdjustmentUnit.FIXED_AMOUNT, direction: CampaignAdjustmentDirection.DECREASE, value: '15' }).newPrice).toBe('85.0000');
    });
  });

  describe('compare-at handling', () => {
    it('preserves an existing compare-at as the value revert restores', () => {
      // Already on sale at 80 (was 150). A new campaign must not lose the 150 —
      // `oldCompareAtPrice` is what puts the earlier sale back, not full price.
      const result = calculatePrice({
        currentPrice: '80.00',
        currentCompareAtPrice: '150.00',
        basePrice: '80.00',
        adjustment: percentDecrease('25'),
        setCompareAt: false,
      });
      expect(result.newPrice).toBe('60.0000');
      expect(result.newCompareAtPrice).toBe('150.0000');
    });

    it('treats a zero compare-at as a real value, not as absent', () => {
      const result = calculatePrice({
        currentPrice: '50.00',
        currentCompareAtPrice: '0',
        basePrice: '50.00',
        adjustment: percentDecrease('10'),
        setCompareAt: true,
      });
      expect(result.newCompareAtPrice).toBe('50.0000');
    });

    it('leaves a null compare-at null when there is no saving to show', () => {
      const result = calculatePrice({
        currentPrice: '50.00',
        currentCompareAtPrice: null,
        basePrice: '50.00',
        adjustment: fixedIncrease('10'),
        setCompareAt: true,
      });
      expect(result.newCompareAtPrice).toBeNull();
      expect(result.warnings).toContain('COMPARE_AT_SUPPRESSED');
    });

    it('discounts from compare-at when that is the basis', () => {
      // 20% off the *original* 150, not off the current sale price of 80.
      const base = resolveBasePrice({
        priceSource: CampaignPriceSource.SHOPIFY_CURRENT,
        basis: CampaignBasis.COMPARE_AT_PRICE,
        currentPrice: '80.00',
        currentCompareAtPrice: '150.00',
      });
      const result = calculatePrice({
        currentPrice: '80.00',
        currentCompareAtPrice: '150.00',
        basePrice: base!,
        adjustment: percentDecrease('20'),
      });
      expect(result.newPrice).toBe('120.0000');
    });
  });

  describe('rounding that fights the discount', () => {
    it('flags a discount that rounding pushed back above the base', () => {
      // Rounding UP with no adjustment turns 11.00 into 11.99 — a campaign
      // that raises prices while claiming to round them.
      const result = at('11.00', null, { roundTo: '0.99' });
      expect(result.newPrice).toBe('11.9900');
      expect(result.warnings).toContain('ROUNDING_OPPOSED_DIRECTION');
    });

    it('does not flag a discount that stays a discount', () => {
      const result = at('13.00', percentDecrease('20'), { roundTo: '0.99' });
      expect(result.newPrice).toBe('10.9900');
      expect(result.warnings).not.toContain('ROUNDING_OPPOSED_DIRECTION');
    });

    it('does not flag rounding that lowers a price with no adjustment', () => {
      // Rounding down to the ending is exactly what "round my prices" means.
      const result = at('11.00', null, {
        roundTo: '0.99',
        roundStrategy: 'DOWN',
      });
      expect(result.newPrice).toBe('10.9900');
      expect(result.warnings).not.toContain('ROUNDING_OPPOSED_DIRECTION');
    });

    it('NEAREST avoids the problem', () => {
      const result = at('11.00', null, {
        roundTo: '0.99',
        roundStrategy: 'NEAREST',
      });
      expect(result.newPrice).toBe('10.9900');
      expect(result.warnings).not.toContain('ROUNDING_OPPOSED_DIRECTION');
    });
  });

  describe('prices at and below zero', () => {
    it('reaches exactly zero on a 100% discount without flooring', () => {
      const result = at('19.99', percentDecrease('100'));
      expect(result.newPrice).toBe('0.0000');
      // Zero is the honest answer here, not a clamp.
      expect(result.outcome).toBe('CHANGED');
    });

    it('marks a floored row as one not to apply', () => {
      const result = at('10.00', fixedDecrease('25'));
      expect(result.newPrice).toBe('0.0000');
      expect(result.outcome).toBe('FLOORED');
      // Writing zero is worse than writing nothing: the merchant cannot tell
      // "free by design" from "the maths went wrong".
      expect(shouldApply(result)).toBe(false);
    });

    it('does not apply a row that did not change', () => {
      expect(shouldApply(at('10.00', percentDecrease('0')))).toBe(false);
    });

    it('applies an ordinary change', () => {
      expect(shouldApply(at('10.00', percentDecrease('10')))).toBe(true);
    });
  });

  describe('numeric(19,4) boundaries', () => {
    it('keeps four decimal places through a percentage', () => {
      // 33.333% of 19.99 is 6.6632667, which rounds half-up to 6.6633 and
      // leaves 13.3267 — four places exactly, no float drift.
      expect(at('19.99', percentDecrease('33.333')).newPrice).toBe('13.3267');
    });

    it('handles the smallest representable amount', () => {
      expect(at('0.0002', fixedDecrease('0.0001')).newPrice).toBe('0.0001');
    });

    it('handles the largest representable price', () => {
      // 15 integer digits is the ceiling of numeric(19,4).
      const huge = '999999999999999.0000';
      expect(
        calculatePrice({
          currentPrice: huge,
          basePrice: huge,
          adjustment: percentDecrease('50'),
        }).newPrice,
      ).toBe('499999999999999.5000');
    });

    it('rejects a price with more precision than the column holds', () => {
      expect(() =>
        calculatePrice({ currentPrice: '10.00001', basePrice: '10.00001' }),
      ).toThrow(/currentPrice/);
    });
  });
});
