import { useCallback } from 'react';
import type { ShopifyProductSummary } from '@pricelogic/shared';
import { fetchProducts } from '../../api/catalog';
import { usePagedSearch } from '../../hooks/usePagedSearch';
import { ResourcePicker } from './ResourcePicker';

interface ProductPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

/** Backs "Include by Products" and, in Phase 5, sheet match review. */
export function ProductPicker({ selectedIds, onChange }: ProductPickerProps) {
  const load = useCallback(
    ({ query, after }: { query: string; after: string | null }) =>
      fetchProducts({ query, after }),
    [],
  );

  const search = usePagedSearch<ShopifyProductSummary>(load);

  return (
    <ResourcePicker
      items={search.items.map((product) => ({
        id: product.id,
        title: product.title,
        subtitle: [product.vendor, product.productType]
          .filter(Boolean)
          .join(' · '),
        imageUrl: product.featuredImageUrl,
      }))}
      selectedIds={selectedIds}
      onSelectionChange={onChange}
      query={search.query}
      onQueryChange={search.setQuery}
      loading={search.loading}
      loadingMore={search.loadingMore}
      error={search.error}
      hasNextPage={search.hasNextPage}
      onLoadMore={search.loadMore}
      onRetry={search.retry}
      searchPlaceholder="Search products"
      emptyMessage={
        search.query
          ? `No products match “${search.query}”.`
          : 'This store has no products yet.'
      }
      resourceName={{ singular: 'product', plural: 'products' }}
    />
  );
}
