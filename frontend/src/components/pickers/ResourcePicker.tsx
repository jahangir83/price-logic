import {
  Banner,
  Button,
  InlineStack,
  ResourceItem,
  ResourceList,
  TextField,
  Thumbnail,
  BlockStack,
  Text,
} from '@shopify/polaris';
import type { ReactNode } from 'react';

export interface PickerItem {
  id: string;
  title: string;
  /** Second line: a vendor, a handle, a product count. */
  subtitle?: string | null;
  imageUrl?: string | null;
}

interface ResourcePickerProps {
  items: PickerItem[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  query: string;
  onQueryChange: (query: string) => void;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasNextPage: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  searchPlaceholder: string;
  emptyMessage: string;
  resourceName: { singular: string; plural: string };
  footer?: ReactNode;
}

/**
 * The shared body of every catalog picker.
 *
 * One component rather than three because products, collections and facets
 * differ only in what they fetch and how a row is labelled — search,
 * multi-select, cursor pagination and the error state are identical, and three
 * copies would drift.
 *
 * Selection is controlled by the caller. Phase 3 wires the same picker into
 * both the include and the exclude side of a campaign, and Phase 5 reuses the
 * product one for sheet match review, so the component must not own the list
 * it is editing.
 */
export function ResourcePicker({
  items,
  selectedIds,
  onSelectionChange,
  query,
  onQueryChange,
  loading,
  loadingMore,
  error,
  hasNextPage,
  onLoadMore,
  onRetry,
  searchPlaceholder,
  emptyMessage,
  resourceName,
  footer,
}: ResourcePickerProps) {
  if (error) {
    return (
      <Banner tone="critical" title="Could not load from Shopify">
        <BlockStack gap="200">
          <Text as="p">{error}</Text>
          <InlineStack>
            <Button onClick={onRetry}>Try again</Button>
          </InlineStack>
        </BlockStack>
      </Banner>
    );
  }

  return (
    <BlockStack gap="300">
      <TextField
        label={searchPlaceholder}
        labelHidden
        value={query}
        onChange={onQueryChange}
        placeholder={searchPlaceholder}
        autoComplete="off"
        clearButton
        onClearButtonClick={() => onQueryChange('')}
      />

      <ResourceList
        resourceName={resourceName}
        items={items}
        loading={loading}
        selectable
        selectedItems={selectedIds}
        onSelectionChange={(selection) =>
          // Polaris hands back the string 'All' when the header checkbox is
          // used; expanding it here keeps the caller's list concrete.
          onSelectionChange(
            selection === 'All' ? items.map((item) => item.id) : selection,
          )
        }
        emptyState={
          loading ? undefined : (
            <BlockStack gap="200" inlineAlign="center">
              <Text as="p" tone="subdued">
                {emptyMessage}
              </Text>
            </BlockStack>
          )
        }
        renderItem={(item: PickerItem) => (
          <ResourceItem
            id={item.id}
            onClick={() => {
              onSelectionChange(
                selectedIds.includes(item.id)
                  ? selectedIds.filter((id) => id !== item.id)
                  : [...selectedIds, item.id],
              );
            }}
            media={
              item.imageUrl ? (
                <Thumbnail source={item.imageUrl} alt="" size="small" />
              ) : undefined
            }
            accessibilityLabel={`Select ${item.title}`}
          >
            <Text as="span" fontWeight="semibold">
              {item.title}
            </Text>
            {item.subtitle ? (
              <Text as="p" tone="subdued">
                {item.subtitle}
              </Text>
            ) : null}
          </ResourceItem>
        )}
      />

      {hasNextPage ? (
        <InlineStack align="center">
          <Button onClick={onLoadMore} loading={loadingMore}>
            Load more
          </Button>
        </InlineStack>
      ) : null}

      {footer}
    </BlockStack>
  );
}
