import { useEffect, useMemo, useState } from 'react';
import { Banner, BlockStack, Button, InlineStack, Tabs, Text } from '@shopify/polaris';
import { ApiError } from '../../api/client';
import { fetchFacets, type CatalogFacets } from '../../api/catalog';
import { ResourcePicker } from './ResourcePicker';

export type FacetKind = 'TAG' | 'VENDOR' | 'PRODUCT_TYPE';

export interface FacetSelection {
  tags: string[];
  vendors: string[];
  productTypes: string[];
}

interface FacetPickerProps {
  selection: FacetSelection;
  onChange: (selection: FacetSelection) => void;
}

const TABS: { id: FacetKind; content: string; key: keyof FacetSelection }[] = [
  { id: 'TAG', content: 'Tags', key: 'tags' },
  { id: 'VENDOR', content: 'Vendors', key: 'vendors' },
  { id: 'PRODUCT_TYPE', content: 'Product types', key: 'productTypes' },
];

/**
 * Backs "Include by Tags, Vendors, and Product Types".
 *
 * Unlike products and collections these are three short, shop-wide lists, so
 * they are fetched **once** and filtered in the browser. Round-tripping a
 * keystroke to Shopify for a list of forty vendors would spend rate-limit
 * budget to be slower than doing nothing.
 */
export function FacetPicker({ selection, onChange }: FacetPickerProps) {
  const [facets, setFacets] = useState<CatalogFacets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tabIndex, setTabIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const retry = () => {
    setLoading(true);
    setError(null);
    setReloadToken((n) => n + 1);
  };

  useEffect(() => {
    let cancelled = false;

    // No setState in the effect body: `loading` starts true and the retry
    // handler resets it, so this only ever writes state after an await.
    fetchFacets()
      .then((loaded) => {
        if (!cancelled) setFacets(loaded);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Could not load from Shopify.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const tab = TABS[tabIndex] ?? TABS[0]!;

  const filtered = useMemo(() => {
    // `facets?.[tab.key] ?? []` is built inside the memo: as an expression
    // outside it, the fallback array is a new reference every render and the
    // memo never hits.
    const values = facets?.[tab.key] ?? [];
    const needle = query.trim().toLowerCase();
    return needle
      ? values.filter((value) => value.toLowerCase().includes(needle))
      : values;
  }, [facets, tab.key, query]);

  if (error) {
    return (
      <Banner tone="critical" title="Could not load from Shopify">
        <BlockStack gap="200">
          <Text as="p">{error}</Text>
          <InlineStack>
            <Button onClick={retry}>Try again</Button>
          </InlineStack>
        </BlockStack>
      </Banner>
    );
  }

  return (
    <BlockStack gap="300">
      <Tabs
        tabs={TABS.map((entry) => ({ id: entry.id, content: entry.content }))}
        selected={tabIndex}
        onSelect={(index) => {
          setTabIndex(index);
          // The filter belongs to the list being shown, not to the picker.
          setQuery('');
        }}
      />

      <ResourcePicker
        // A tag's value is its identity — there is no id to key on.
        items={filtered.map((value) => ({ id: value, title: value }))}
        selectedIds={selection[tab.key]}
        onSelectionChange={(ids) =>
          onChange({ ...selection, [tab.key]: ids })
        }
        query={query}
        onQueryChange={setQuery}
        loading={loading}
        loadingMore={false}
        error={null}
        hasNextPage={false}
        onLoadMore={() => undefined}
        onRetry={retry}
        searchPlaceholder={`Filter ${tab.content.toLowerCase()}`}
        emptyMessage={
          query
            ? `No ${tab.content.toLowerCase()} match “${query}”.`
            : `This store has no ${tab.content.toLowerCase()} yet.`
        }
        resourceName={{
          singular: tab.content.toLowerCase(),
          plural: tab.content.toLowerCase(),
        }}
      />
    </BlockStack>
  );
}
