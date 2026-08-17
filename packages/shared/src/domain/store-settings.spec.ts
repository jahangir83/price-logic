import {
  DEFAULT_STORE_SETTINGS,
  StockSkipReason,
  stockSkipReason,
} from './store-settings.js';

describe('stockSkipReason', () => {
  const on = { skipOutOfStock: true };
  const off = { skipOutOfStock: false };

  it('leaves a row alone when the supplier has none', () => {
    expect(stockSkipReason({ supplier: 0, shop: 40 }, on)).toBe(
      StockSkipReason.SUPPLIER,
    );
  });

  it('leaves a row alone when the shop has none', () => {
    expect(stockSkipReason({ supplier: 100, shop: 0 }, on)).toBe(
      StockSkipReason.SHOP,
    );
  });

  it('blames the supplier first when both are out', () => {
    // The more actionable of the two: "they cannot send it" is a different
    // problem from "you have run out".
    expect(stockSkipReason({ supplier: 0, shop: 0 }, on)).toBe(
      StockSkipReason.SUPPLIER,
    );
  });

  it('treats a negative quantity as out of stock', () => {
    // Shopify reports oversold variants as negative.
    expect(stockSkipReason({ shop: -3 }, on)).toBe(StockSkipReason.SHOP);
  });

  it('does not treat unknown stock as no stock', () => {
    // A sheet with no stock column and an untracked variant both arrive null.
    // Reading that as "none" would silently stop repricing most of a store.
    expect(stockSkipReason({ supplier: null, shop: null }, on)).toBeNull();
    expect(stockSkipReason({}, on)).toBeNull();
  });

  it('updates a row that is in stock', () => {
    expect(stockSkipReason({ supplier: 5, shop: 2 }, on)).toBeNull();
  });

  it('never skips when the merchant has turned it off', () => {
    expect(stockSkipReason({ supplier: 0, shop: 0 }, off)).toBeNull();
  });

  it('is on by default', () => {
    // What was asked for: out-of-stock products are not updated unless the
    // merchant says otherwise.
    expect(DEFAULT_STORE_SETTINGS.skipOutOfStock).toBe(true);
  });
});
