import { normalisePrice, parseSheet, tokenizeCsv } from './csv-parser';

describe('tokenizeCsv', () => {
  it('reads a plain file', () => {
    expect(tokenizeCsv('sku,price\nA,10.00')).toEqual([
      ['sku', 'price'],
      ['A', '10.00'],
    ]);
  });

  it('strips the BOM Excel writes', () => {
    // Left in place it becomes part of the first header and "sku" stops
    // matching, which looks like a missing column.
    const [headers] = tokenizeCsv('﻿sku,price\nA,10.00');
    expect(headers?.[0]).toBe('sku');
  });

  it('handles CRLF line endings', () => {
    expect(tokenizeCsv('sku,price\r\nA,10.00\r\n')).toEqual([
      ['sku', 'price'],
      ['A', '10.00'],
    ]);
  });

  it('keeps a comma inside a quoted field', () => {
    expect(tokenizeCsv('sku,title\nA,"Shirt, blue"')).toEqual([
      ['sku', 'title'],
      ['A', 'Shirt, blue'],
    ]);
  });

  it('unescapes a doubled quote', () => {
    expect(tokenizeCsv('sku,title\nA,"12"" ruler"')[1]?.[1]).toBe('12" ruler');
  });

  it('keeps a newline inside a quoted field', () => {
    const rows = tokenizeCsv('sku,note\nA,"line one\nline two"');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.[1]).toBe('line one\nline two');
  });

  it('drops a trailing empty line rather than making a phantom row', () => {
    expect(tokenizeCsv('sku,price\nA,10.00\n\n')).toHaveLength(2);
  });

  it('drops a row of empty cells', () => {
    expect(tokenizeCsv('sku,price\nA,10.00\n,,\n')).toHaveLength(2);
  });
});

describe('normalisePrice', () => {
  it.each([
    ['10.00', '10.00'],
    ['$10.00', '10.00'],
    ['£1,234.56', '1234.56'],
    [' 10.5 ', '10.5'],
    ['0.0001', '0.0001'],
  ])('reads %s as %s', (input, expected) => {
    expect(normalisePrice(input)).toBe(expected);
  });

  it.each(['', 'free', 'N/A', '10.00001', '--5'])('rejects %s', (input) => {
    expect(normalisePrice(input)).toBeNull();
  });

  it('refuses to guess European decimal conventions', () => {
    // 1.234,56 could be 1234.56 or 1.23456 depending on locale, and guessing
    // wrong reprices a catalogue by a factor of a hundred.
    expect(normalisePrice('1.234,56')).toBeNull();
  });
});

describe('parseSheet', () => {
  it('maps the columns a supplier actually sends', () => {
    const sheet = parseSheet(
      'Item Number,Selling Price,Compare At Price\nABC-1,10.00,20.00',
    );
    expect(sheet.fatalError).toBeNull();
    expect(sheet.columnMap.sku).toBe('Item Number');
    expect(sheet.columnMap.price).toBe('Selling Price');
    expect(sheet.columnMap.compareAtPrice).toBe('Compare At Price');
  });

  it('matches headers regardless of spacing and case', () => {
    const sheet = parseSheet('compare_at_price,SKU,PRICE\n20.00,A,10.00');
    expect(sheet.columnMap.sku).toBe('SKU');
    expect(sheet.columnMap.compareAtPrice).toBe('compare_at_price');
  });

  it('rejects a file with no SKU column, naming what it found', () => {
    // The one case where failing the whole upload beats 5,000 identical row
    // errors: this is not a supplier sheet at all.
    const sheet = parseSheet('name,price\nShirt,10.00');
    expect(sheet.fatalError).toMatch(/needs a column for sku/);
    expect(sheet.fatalError).toMatch(/name, price/);
  });

  it('rejects an empty file', () => {
    expect(parseSheet('').fatalError).toBe('The file is empty.');
  });

  it('numbers rows the way the merchant sees them', () => {
    // Header is row 1, so the first data row is row 2.
    const sheet = parseSheet('sku,price\nA,10.00\nB,20.00');
    expect(sheet.rows.map((row) => row.rowNumber)).toEqual([2, 3]);
  });

  it('keeps the original row for support questions', () => {
    const sheet = parseSheet('sku,price,note\nA,10.00,seasonal');
    expect(sheet.rows[0]?.raw).toEqual({
      sku: 'A',
      price: '10.00',
      note: 'seasonal',
    });
  });

  it('optional compare-at is optional', () => {
    const sheet = parseSheet('sku,price\nA,10.00');
    expect(sheet.rows[0]?.error).toBeNull();
    expect(sheet.rows[0]?.compareAtPrice).toBeNull();
  });

  describe('row-level problems never fail the file', () => {
    const sheet = parseSheet(
      [
        'sku,price',
        'GOOD-1,10.00',
        ',15.00',
        'NOPRICE,',
        'BAD-PRICE,free',
        'NEGATIVE,-5.00',
        'ZERO,0.00',
        'GOOD-2,20.00',
      ].join('\n'),
    );

    it('parses every row', () => {
      expect(sheet.fatalError).toBeNull();
      expect(sheet.rows).toHaveLength(7);
    });

    it('keeps the good rows good', () => {
      const good = sheet.rows.filter((row) => row.error === null);
      expect(good.map((row) => row.sku)).toEqual(['GOOD-1', 'GOOD-2']);
    });

    it.each([
      [1, /no SKU/],
      [2, /no price/],
      [3, /not a price we can read/],
      [4, /negative/],
      [5, /zero/],
    ])('explains row index %i specifically', (index, pattern) => {
      expect(sheet.rows[index]?.error).toMatch(pattern);
    });
  });

  describe('duplicate SKUs', () => {
    const sheet = parseSheet(
      ['sku,price', 'DUP,10.00', 'UNIQUE,20.00', 'DUP,12.00'].join('\n'),
    );

    it('flags both copies, not just the second', () => {
      // Letting the last one win would apply a real, wrong price to a live
      // storefront with nothing to notice.
      expect(sheet.rows[0]?.error).toMatch(/appears 2 times/);
      expect(sheet.rows[2]?.error).toMatch(/appears 2 times/);
    });

    it('leaves the unique row alone', () => {
      expect(sheet.rows[1]?.error).toBeNull();
    });

    it('matches SKUs case-insensitively', () => {
      const mixed = parseSheet(
        ['sku,price', 'abc,1.00', 'ABC,2.00'].join('\n'),
      );
      expect(mixed.rows.every((row) => row.error !== null)).toBe(true);
    });

    it('does not count an already-invalid row as a duplicate', () => {
      const withBad = parseSheet(
        ['sku,price', 'DUP,notaprice', 'DUP,10.00'].join('\n'),
      );
      expect(withBad.rows[0]?.error).toMatch(/not a price/);
      // Only one usable row for this SKU, so it is not ambiguous.
      expect(withBad.rows[1]?.error).toBeNull();
    });
  });
});
