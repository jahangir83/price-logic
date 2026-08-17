import {
  BULK_MUTATION_CHUNK_SIZE,
  bulkWriteStrategy,
  toShopifyPrice,
  type Money,
} from '@pricelogic/shared';

/**
 * Turning a set of intended price changes into bulk-operation input, and
 * turning the operation's JSONL back into per-variant outcomes.
 *
 * Deliberately pure. Everything here is arithmetic and shape — no repository,
 * no HTTP — because the parts most likely to be wrong (a chunk boundary that
 * drops a variant, an error that gets attributed to the wrong row) are exactly
 * the parts that cannot be tested against a real store without applying real
 * prices to a real storefront.
 */

/** One variant's intended write, as the writer needs it. */
export interface VariantWrite {
  shopifyProductId: string;
  shopifyVariantId: string;
  newPrice: Money;
  newCompareAtPrice: Money | null;
}

/** One line of the JSONL: a single `productVariantsBulkUpdate` invocation. */
export interface BulkMutationLine {
  productId: string;
  variants: {
    id: string;
    price: string;
    compareAtPrice?: string | null;
  }[];
}

export interface BulkChunk {
  /** The JSONL lines, one per product. */
  lines: BulkMutationLine[];
  /** Every variant id in this chunk, for recording what was submitted. */
  variantIds: string[];
}

/**
 * The mutation the bulk operation runs, once per JSONL line.
 *
 * `productVariantsBulkUpdate` is the same mutation the synchronous path uses.
 * That is the point: the two paths differ in how the call is delivered, never
 * in what it does, so a merchant's prices do not depend on how many of them
 * there were.
 */
export const BULK_VARIANT_PRICE_MUTATION = `
  mutation call($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }
`;

/**
 * Group writes into bulk-operation chunks.
 *
 * A product is never split across two chunks. `productVariantsBulkUpdate` takes
 * a product and its variants together, so splitting one would mean two
 * invocations racing to write the same product — and Shopify's own
 * documentation warns that concurrent writes to one product are rejected. The
 * chunk size is therefore a target rather than a hard cap: a product with more
 * variants than the remaining room starts the next chunk instead of being cut
 * in half.
 */
export function chunkForBulkMutation(
  writes: readonly VariantWrite[],
  chunkSize: number = BULK_MUTATION_CHUNK_SIZE,
): BulkChunk[] {
  const byProduct = new Map<string, VariantWrite[]>();
  for (const write of writes) {
    const bucket = byProduct.get(write.shopifyProductId);
    if (bucket) bucket.push(write);
    else byProduct.set(write.shopifyProductId, [write]);
  }

  const chunks: BulkChunk[] = [];
  let current: BulkChunk = { lines: [], variantIds: [] };

  for (const [productId, rows] of byProduct) {
    if (
      current.variantIds.length > 0 &&
      current.variantIds.length + rows.length > chunkSize
    ) {
      chunks.push(current);
      current = { lines: [], variantIds: [] };
    }

    current.lines.push({
      productId,
      variants: rows.map((row) => ({
        id: row.shopifyVariantId,
        // Shopify stores two decimal places and rejects four.
        price: toShopifyPrice(row.newPrice),
        ...(row.newCompareAtPrice === null
          ? { compareAtPrice: null }
          : { compareAtPrice: toShopifyPrice(row.newCompareAtPrice) }),
      })),
    });
    current.variantIds.push(...rows.map((row) => row.shopifyVariantId));
  }

  if (current.variantIds.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

/** Whether this set goes through a bulk operation at all. */
export function shouldUseBulkOperation(variantCount: number): boolean {
  return bulkWriteStrategy(variantCount).useBulkOperation;
}

/**
 * One line of a bulk *mutation's* JSONL result.
 *
 * Each line is the payload of one invocation, plus `__lineNumber` telling us
 * which input line produced it. A line that failed outright carries no `data`
 * at all, which is why every field here is optional.
 */
export interface BulkMutationResultLine {
  data?: {
    productVariantsBulkUpdate?: {
      productVariants?: { id: string }[] | null;
      userErrors?: { field: string[] | null; message: string }[] | null;
    } | null;
  } | null;
  __lineNumber?: number;
}

export interface VariantOutcome {
  variantId: string;
  applied: boolean;
  error: string | null;
}

/**
 * Read a bulk mutation's results into one outcome per submitted variant.
 *
 * Two rules, both there to stop a failure looking like a success:
 *
 * - A variant Shopify did not confirm is **not** applied, even when no error
 *   mentions it. Marking a row APPLIED that never was leaves a price the app
 *   believes it set and revert will happily "restore" over the real one.
 * - A variant with no result line at all is not applied either. A truncated or
 *   partial JSONL is precisely when the optimistic reading is most tempting and
 *   most wrong.
 */
export function interpretBulkResults(
  submitted: readonly BulkMutationLine[],
  lines: readonly BulkMutationResultLine[],
): VariantOutcome[] {
  const confirmed = new Set<string>();
  const errors = new Map<string, string>();
  // Errors that name no variant apply to every variant of their line.
  const lineErrors = new Map<number, string>();

  for (const line of lines) {
    const payload = line.data?.productVariantsBulkUpdate;
    for (const variant of payload?.productVariants ?? []) {
      confirmed.add(variant.id);
    }

    for (const error of payload?.userErrors ?? []) {
      /*
       * Shopify reports positionally — `field: ["variants", "3", "price"]` —
       * so the index locates the variant within the *submitted* line. Without
       * a line number to anchor it, the index is meaningless and the message
       * is treated as covering the whole invocation.
       */
      const lineNumber = line.__lineNumber;
      const index = Number(error.field?.[1]);
      const submittedLine =
        lineNumber === undefined ? undefined : submitted[lineNumber - 1];

      if (submittedLine && Number.isInteger(index)) {
        const variant = submittedLine.variants[index];
        if (variant) {
          errors.set(variant.id, error.message);
          continue;
        }
      }

      if (lineNumber !== undefined) {
        const existing = lineErrors.get(lineNumber);
        lineErrors.set(
          lineNumber,
          existing ? `${existing}; ${error.message}` : error.message,
        );
      }
    }
  }

  const outcomes: VariantOutcome[] = [];
  submitted.forEach((line, index) => {
    const lineError = lineErrors.get(index + 1);
    for (const variant of line.variants) {
      const error = errors.get(variant.id) ?? lineError;
      if (error) {
        outcomes.push({ variantId: variant.id, applied: false, error });
        continue;
      }
      outcomes.push(
        confirmed.has(variant.id)
          ? { variantId: variant.id, applied: true, error: null }
          : {
              variantId: variant.id,
              applied: false,
              error: 'Shopify did not confirm this variant was updated.',
            },
      );
    }
  });

  return outcomes;
}
