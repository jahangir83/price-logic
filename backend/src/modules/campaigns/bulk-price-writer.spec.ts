import { parseMoney } from '@pricelogic/shared';
import {
  chunkForBulkMutation,
  interpretBulkResults,
  shouldUseBulkOperation,
  type BulkMutationLine,
  type VariantWrite,
} from './bulk-price-writer';

const write = (
  productId: string,
  variantId: string,
  price = '10.00',
): VariantWrite => ({
  shopifyProductId: `gid://shopify/Product/${productId}`,
  shopifyVariantId: `gid://shopify/ProductVariant/${variantId}`,
  newPrice: parseMoney(price),
  newCompareAtPrice: null,
});

describe('chunkForBulkMutation', () => {
  it('puts every variant of a product on one line', () => {
    const chunks = chunkForBulkMutation([
      write('1', 'a'),
      write('1', 'b'),
      write('2', 'c'),
    ]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].lines).toHaveLength(2);
    expect(chunks[0].lines[0].variants).toHaveLength(2);
    expect(chunks[0].variantIds).toHaveLength(3);
  });

  it('formats prices the way Shopify accepts them', () => {
    // Four decimal places are rejected outright, which would fail the whole
    // invocation rather than the one variant.
    const [chunk] = chunkForBulkMutation([write('1', 'a', '10.5')]);
    expect(chunk.lines[0].variants[0].price).toBe('10.50');
  });

  it('sends an explicit null to clear a compare-at price', () => {
    // Omitting the field leaves the old compare-at in place, so a campaign
    // that means to clear it would silently not.
    const [chunk] = chunkForBulkMutation([write('1', 'a')]);
    expect(chunk.lines[0].variants[0]).toHaveProperty('compareAtPrice', null);
  });

  it('splits into chunks at the requested size', () => {
    const writes = Array.from({ length: 10 }, (_, index) =>
      write(String(index), `v${index}`),
    );
    const chunks = chunkForBulkMutation(writes, 4);

    expect(chunks.map((chunk) => chunk.variantIds.length)).toEqual([4, 4, 2]);
    // Nothing may be dropped at a boundary.
    expect(chunks.flatMap((chunk) => chunk.variantIds)).toHaveLength(10);
  });

  it('never splits one product across two chunks', () => {
    // Two invocations writing the same product would race, and Shopify rejects
    // concurrent writes to a single product.
    const writes = [
      write('1', 'a'),
      write('1', 'b'),
      write('1', 'c'),
      write('2', 'd'),
    ];
    const chunks = chunkForBulkMutation(writes, 2);

    for (const chunk of chunks) {
      const products = chunk.lines.map((line) => line.productId);
      expect(new Set(products).size).toBe(products.length);
    }
    const productOne = chunks.filter((chunk) =>
      chunk.lines.some((line) => line.productId.endsWith('/1')),
    );
    expect(productOne).toHaveLength(1);
  });

  it('returns nothing for an empty set rather than an empty chunk', () => {
    expect(chunkForBulkMutation([])).toEqual([]);
  });
});

describe('shouldUseBulkOperation', () => {
  it('follows the shared threshold', () => {
    expect(shouldUseBulkOperation(499)).toBe(false);
    expect(shouldUseBulkOperation(500)).toBe(true);
  });
});

describe('interpretBulkResults', () => {
  const submitted: BulkMutationLine[] = [
    {
      productId: 'gid://shopify/Product/1',
      variants: [
        { id: 'gid://shopify/ProductVariant/a', price: '10.00' },
        { id: 'gid://shopify/ProductVariant/b', price: '11.00' },
      ],
    },
    {
      productId: 'gid://shopify/Product/2',
      variants: [{ id: 'gid://shopify/ProductVariant/c', price: '12.00' }],
    },
  ];

  it('marks confirmed variants applied', () => {
    const outcomes = interpretBulkResults(submitted, [
      {
        __lineNumber: 1,
        data: {
          productVariantsBulkUpdate: {
            productVariants: [
              { id: 'gid://shopify/ProductVariant/a' },
              { id: 'gid://shopify/ProductVariant/b' },
            ],
            userErrors: [],
          },
        },
      },
      {
        __lineNumber: 2,
        data: {
          productVariantsBulkUpdate: {
            productVariants: [{ id: 'gid://shopify/ProductVariant/c' }],
            userErrors: [],
          },
        },
      },
    ]);

    expect(outcomes.every((outcome) => outcome.applied)).toBe(true);
    expect(outcomes).toHaveLength(3);
  });

  it('attributes a positional error to the right variant', () => {
    const outcomes = interpretBulkResults(submitted, [
      {
        __lineNumber: 1,
        data: {
          productVariantsBulkUpdate: {
            productVariants: [{ id: 'gid://shopify/ProductVariant/a' }],
            userErrors: [
              {
                field: ['variants', '1', 'price'],
                message: 'Price is invalid',
              },
            ],
          },
        },
      },
    ]);

    const a = outcomes.find((outcome) => outcome.variantId.endsWith('/a'));
    const b = outcomes.find((outcome) => outcome.variantId.endsWith('/b'));
    expect(a?.applied).toBe(true);
    expect(b).toEqual({
      variantId: 'gid://shopify/ProductVariant/b',
      applied: false,
      error: 'Price is invalid',
    });
  });

  it('applies an unattributable error to every variant of its line', () => {
    const outcomes = interpretBulkResults(submitted, [
      {
        __lineNumber: 1,
        data: {
          productVariantsBulkUpdate: {
            productVariants: [],
            userErrors: [{ field: null, message: 'Product is not available' }],
          },
        },
      },
    ]);

    const lineOne = outcomes.filter((outcome) =>
      ['/a', '/b'].some((suffix) => outcome.variantId.endsWith(suffix)),
    );
    expect(lineOne).toHaveLength(2);
    expect(lineOne.every((outcome) => !outcome.applied)).toBe(true);
    expect(lineOne[0].error).toBe('Product is not available');
  });

  it('does not mark a variant applied that Shopify never confirmed', () => {
    // Silence is not success. A row marked APPLIED that never was leaves a
    // price the app believes it set, and revert would overwrite the real one.
    const outcomes = interpretBulkResults(submitted, [
      {
        __lineNumber: 1,
        data: {
          productVariantsBulkUpdate: {
            productVariants: [{ id: 'gid://shopify/ProductVariant/a' }],
            userErrors: [],
          },
        },
      },
    ]);

    const b = outcomes.find((outcome) => outcome.variantId.endsWith('/b'));
    expect(b?.applied).toBe(false);
    expect(b?.error).toMatch(/did not confirm/i);
  });

  it('treats a missing result line as unapplied, not as success', () => {
    // A truncated JSONL is exactly when an optimistic reading is most tempting.
    const outcomes = interpretBulkResults(submitted, []);

    expect(outcomes).toHaveLength(3);
    expect(outcomes.every((outcome) => !outcome.applied)).toBe(true);
  });

  it('survives a line that failed hard enough to carry no data', () => {
    const outcomes = interpretBulkResults(submitted, [
      { __lineNumber: 1, data: null },
    ]);

    expect(outcomes).toHaveLength(3);
    expect(outcomes.every((outcome) => !outcome.applied)).toBe(true);
  });
});
