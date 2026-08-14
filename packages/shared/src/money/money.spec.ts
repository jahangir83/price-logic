import {
  MoneyError,
  add,
  compare,
  divide,
  formatMoney,
  fromMinor,
  isMoney,
  max,
  min,
  multiply,
  parseMoney,
  percentOf,
  subtract,
  toMinor,
  toShopifyPrice,
  tryParseMoney,
} from './money.js';
import { applyPriceEnding } from './rounding.js';

describe('money validation', () => {
  it.each(['0', '10', '10.5', '10.5000', '-3.25', '0.0001', '999999999999999'])(
    'accepts %s',
    (value) => {
      expect(isMoney(value)).toBe(true);
    },
  );

  it.each([
    '10.00001', // more than 4 decimal places
    '1e3', // exponent notation
    '$10',
    '10.',
    '',
    '1234567890123456', // 16 integer digits, past numeric(19,4)
    'NaN',
  ])('rejects %s', (value) => {
    expect(isMoney(value)).toBe(false);
  });

  it('rejects non-strings, including the numbers the constitution bans', () => {
    expect(isMoney(10.5)).toBe(false);
    expect(isMoney(null)).toBe(false);
    expect(isMoney(undefined)).toBe(false);
  });

  it('normalises to the exact shape numeric(19,4) returns', () => {
    expect(parseMoney('10')).toBe('10.0000');
    expect(parseMoney('10.5')).toBe('10.5000');
    expect(parseMoney('-0.1')).toBe('-0.1000');
  });

  it('throws on an unparseable price rather than defaulting it to zero', () => {
    expect(() => parseMoney('abc', 'sheetPrice')).toThrow(MoneyError);
    expect(() => parseMoney('abc', 'sheetPrice')).toThrow(/sheetPrice/);
  });

  it('offers a non-throwing variant for CSV cells', () => {
    expect(tryParseMoney('12.30')).toBe('12.3000');
    expect(tryParseMoney('twelve')).toBeNull();
  });
});

describe('minor-unit conversion', () => {
  it('round-trips', () => {
    for (const value of ['0.0000', '10.5000', '-3.2500', '0.0001']) {
      expect(fromMinor(toMinor(value))).toBe(value);
    }
  });

  it('scales by 10^4', () => {
    expect(toMinor('1')).toBe(10000n);
    expect(toMinor('0.0001')).toBe(1n);
    expect(toMinor('-1.5')).toBe(-15000n);
  });
});

describe('arithmetic', () => {
  it('adds without float drift', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in float arithmetic.
    expect(add('0.1', '0.2')).toBe('0.3000');
  });

  it('subtracts past zero', () => {
    expect(subtract('10', '12.50')).toBe('-2.5000');
  });

  it('multiplies with half-up rounding at the 4th place', () => {
    expect(multiply('10', '1.5')).toBe('15.0000');
    // 0.00005 rounds away from zero, not to even.
    expect(multiply('0.0001', '0.5')).toBe('0.0001');
  });

  it('divides with half-up rounding', () => {
    expect(divide('10', '4')).toBe('2.5000');
    expect(divide('1', '3')).toBe('0.3333');
    expect(divide('2', '3')).toBe('0.6667');
  });

  it('refuses to divide by zero', () => {
    expect(() => divide('10', '0')).toThrow(MoneyError);
  });

  it('takes a percentage in one rounding step', () => {
    expect(percentOf('100', '12.5')).toBe('12.5000');
    expect(percentOf('19.99', '20')).toBe('3.9980');
    expect(percentOf('0.01', '33.333')).toBe('0.0033');
  });

  it('compares and orders', () => {
    expect(compare('10', '10.0000')).toBe(0);
    expect(compare('9.9999', '10')).toBe(-1);
    expect(compare('10.0001', '10')).toBe(1);
    expect(max('9.99', '10.00')).toBe('10.0000');
    expect(min('9.99', '10.00')).toBe('9.9900');
  });
});

describe('Shopify output', () => {
  it('drops to 2 decimal places, rounding half up', () => {
    expect(toShopifyPrice('15.9950')).toBe('16.00');
    expect(toShopifyPrice('15.9949')).toBe('15.99');
    expect(toShopifyPrice('16')).toBe('16.00');
    expect(toShopifyPrice('-1.005')).toBe('-1.01');
  });

  it('formats for display only', () => {
    expect(formatMoney('1234.5000', 'USD', 'en-US')).toBe('$1,234.50');
  });
});

describe('price endings', () => {
  it('matches the example recorded on campaigns.round_to', () => {
    expect(applyPriceEnding('10.20', '0.99')).toBe('10.9900');
  });

  it('leaves a price that already carries the ending alone', () => {
    expect(applyPriceEnding('10.99', '0.99')).toBe('10.9900');
  });

  it('rounds up past the whole number, which gives back part of a discount', () => {
    // Documented consequence of the UP default — see rounding.ts.
    expect(applyPriceEnding('11.00', '0.99')).toBe('11.9900');
  });

  it('rounds to the nearest ending when asked', () => {
    expect(applyPriceEnding('11.00', '0.99', 'NEAREST')).toBe('10.9900');
    expect(applyPriceEnding('10.20', '0.99', 'NEAREST')).toBe('9.9900');
    expect(applyPriceEnding('10.60', '0.99', 'NEAREST')).toBe('10.9900');
  });

  it('rounds down when asked', () => {
    expect(applyPriceEnding('10.20', '0.99', 'DOWN')).toBe('9.9900');
  });

  it('never goes below zero, whatever the strategy', () => {
    expect(applyPriceEnding('0.40', '0.99', 'DOWN')).toBe('0.9900');
    expect(applyPriceEnding('0.40', '0.99', 'NEAREST')).toBe('0.9900');
  });

  it('supports a .00 ending as plain whole-number rounding', () => {
    expect(applyPriceEnding('10.20', '0')).toBe('11.0000');
    expect(applyPriceEnding('10.20', '0', 'NEAREST')).toBe('10.0000');
  });

  it('rejects an ending that is not a fraction of one unit', () => {
    expect(() => applyPriceEnding('10.00', '1')).toThrow(MoneyError);
    expect(() => applyPriceEnding('10.00', '-0.01')).toThrow(MoneyError);
  });

  it('rejects a negative price', () => {
    expect(() => applyPriceEnding('-1.00', '0.99')).toThrow(MoneyError);
  });
});
