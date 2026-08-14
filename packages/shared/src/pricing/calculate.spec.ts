import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignBasis,
  CampaignPriceSource,
} from '../domain/campaign.js';
import { calculatePrice, resolveBasePrice } from './calculate.js';

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
