import { useEffect, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Card,
  DataTable,
  InlineStack,
  Pagination,
  SkeletonBodyText,
  Text,
} from '@shopify/polaris';
import {
  formatMoney,
  subtract,
  type CampaignPreviewResponse,
  type CampaignPreviewRow,
} from '@pricelogic/shared';
import { ApiError, apiFetch } from '../../api/client';

interface CampaignPreviewProps {
  campaignId: string;
  pageSize?: number;
}

/**
 * What the campaign will do, before it does it.
 *
 * The numbers here come from the server, which produced them with the same
 * `calculatePrice` the browser could have run — but the merchant is approving
 * a change, and the value they approve has to be the value the server computed
 * from its own inputs. Nothing on this screen is sent back; activation
 * recalculates.
 */
export function CampaignPreview({
  campaignId,
  pageSize = 25,
}: CampaignPreviewProps) {
  const [preview, setPreview] = useState<CampaignPreviewResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const retry = () => {
    setLoading(true);
    setError(null);
    setReloadToken((n) => n + 1);
  };

  /*
   * The fetch is inline rather than behind a callback so no state is written
   * synchronously in the effect body. `cancelled` discards a response that
   * lands after the merchant has already paged on — otherwise page 2's slow
   * reply overwrites page 3.
   */
  useEffect(() => {
    let cancelled = false;

    apiFetch<CampaignPreviewResponse>(
      `/campaigns/${campaignId}/preview?page=${page}&pageSize=${pageSize}`,
    )
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Could not build the preview.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId, page, pageSize, reloadToken]);

  if (error) {
    return (
      <Banner
        tone="critical"
        title="Could not build the preview"
        action={{ content: 'Try again', onAction: retry }}
      >
        <Text as="p">{error}</Text>
      </Banner>
    );
  }

  if (loading || !preview) {
    return (
      <Card>
        <SkeletonBodyText lines={6} />
      </Card>
    );
  }

  const skipped = preview.totalVariants - preview.changedVariants;
  const totalPages = Math.max(1, Math.ceil(preview.totalVariants / pageSize));

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="200">
          <InlineStack gap="300" wrap>
            <Badge tone="success">
              {`${preview.changedVariants} variants will change`}
            </Badge>
            {skipped > 0 ? (
              <Badge tone="attention">{`${skipped} left alone`}</Badge>
            ) : null}
            {preview.taggedProducts > 0 ? (
              <Badge>{`${preview.taggedProducts} products will be re-tagged`}</Badge>
            ) : null}
          </InlineStack>

          {preview.totalVariants === 0 ? (
            <Banner tone="warning" title="Nothing matches this campaign">
              <Text as="p">
                No products match the targeting rules, so activating it would
                change nothing. Check the include and exclude lists.
              </Text>
            </Banner>
          ) : null}

          {preview.truncated ? (
            <Banner tone="warning" title="Showing part of the catalog">
              <Text as="p">
                This campaign matches more variants than the preview can list.
                The totals above cover what was checked, not the whole store.
              </Text>
            </Banner>
          ) : null}

          {skipped > 0 ? (
            <Banner tone="info" title={`${skipped} variants will be left alone`}>
              <Text as="p">
                Rows marked below explain why — usually they are already at the
                target price, or the discount is larger than the price.
              </Text>
            </Banner>
          ) : null}
        </BlockStack>
      </Card>

      <Card padding="0">
        <DataTable
          columnContentTypes={['text', 'text', 'numeric', 'numeric', 'numeric', 'text']}
          headings={['Product', 'Variant', 'Now', 'After', 'Difference', '']}
          rows={preview.rows.map((row) => toCells(row))}
          // Row count is the campaign's, not the page's.
          footerContent={`${preview.rows.length} of ${preview.totalVariants} variants`}
        />
      </Card>

      {totalPages > 1 ? (
        <InlineStack align="center">
          <Pagination
            hasPrevious={page > 1}
            onPrevious={() => setPage((current) => current - 1)}
            hasNext={page < totalPages}
            onNext={() => setPage((current) => current + 1)}
            label={`Page ${page} of ${totalPages}`}
          />
        </InlineStack>
      ) : null}
    </BlockStack>
  );
}

function toCells(row: CampaignPreviewRow): (string | React.ReactNode)[] {
  const difference = row.changed
    ? subtract(row.newPrice, row.currentPrice)
    : null;

  return [
    row.productTitle,
    row.variantTitle ?? row.sku ?? '—',
    formatMoney(row.currentPrice, row.currency),
    row.changed ? formatMoney(row.newPrice, row.currency) : '—',
    difference ? (
      <Text
        as="span"
        tone={difference.startsWith('-') ? 'success' : 'caution'}
      >
        {formatMoney(difference, row.currency)}
      </Text>
    ) : (
      '—'
    ),
    row.note ? (
      <Text as="span" tone="subdued">
        {row.note}
      </Text>
    ) : (
      ''
    ),
  ];
}
