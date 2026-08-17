import { useCallback } from 'react';
import type { ShopifyCollectionSummary } from '@pricelogic/shared';
import { fetchCollections } from '../../api/catalog';
import { usePagedSearch } from '../../hooks/usePagedSearch';
import { ResourcePicker } from './ResourcePicker';

interface CollectionPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

/** Backs "Include by Collections". Custom and smart collections are one list. */
export function CollectionPicker({
  selectedIds,
  onChange,
}: CollectionPickerProps) {
  const load = useCallback(
    ({ query, after }: { query: string; after: string | null }) =>
      fetchCollections({ query, after }),
    [],
  );

  const search = usePagedSearch<ShopifyCollectionSummary>(load);

  return (
    <ResourcePicker
      items={search.items.map((collection) => ({
        id: collection.id,
        title: collection.title,
        subtitle:
          collection.productsCount === null
            ? null
            : `${collection.productsCount} products`,
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
      searchPlaceholder="Search collections"
      emptyMessage={
        search.query
          ? `No collections match “${search.query}”.`
          : 'This store has no collections yet.'
      }
      resourceName={{ singular: 'collection', plural: 'collections' }}
    />
  );
}
