import { useEffect, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Card,
  IndexTable,
  InlineStack,
  Page,
  Pagination,
  ProgressBar,
  SkeletonBodyText,
  Text,
} from '@shopify/polaris';
import {
  PriceChangeStatus,
  formatMoney,
  type CampaignProgressResponse,
  type CampaignResultsResponse,
  type PriceChangeDto,
} from '@pricelogic/shared';
import { ApiError, apiFetch } from '../../api/client';

interface CampaignResultsProps {
  campaignId: string;
  currency?: string;
  pageSize?: number;
  /** Back to the campaign's own page — its settings and lifecycle actions. */
  onOpenCampaign?: (campaignId: string) => void;
}

/** How often to re-check while a run is in flight. */
const POLL_MS = 2000;

/**
 * What a campaign did, and what it is doing right now.
 *
 * Failures come first, because that is why this screen gets opened. Every row
 * is readable without a Shopify call — the product and variant titles were
 * cached when the row was written, so a campaign from three months ago still
 * reads properly even if the product has since been renamed or deleted.
 */
export function CampaignResults({
  campaignId,
  currency = 'USD',
  pageSize = 25,
  onOpenCampaign,
}: CampaignResultsProps) {
  const [results, setResults] = useState<CampaignResultsResponse | null>(null);
  const [progress, setProgress] = useState<CampaignProgressResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      apiFetch<CampaignResultsResponse>(
        `/campaigns/${campaignId}/results?page=${page}&pageSize=${pageSize}`,
      ),
      apiFetch<CampaignProgressResponse>(`/campaigns/${campaignId}/progress`),
    ])
      .then(([loadedResults, loadedProgress]) => {
        if (cancelled) return;
        setResults(loadedResults);
        setProgress(loadedProgress);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError ? cause.message : 'Could not load results.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId, page, pageSize]);

  /*
   * Poll only while work is outstanding, and stop the moment it is not. A
   * long bulk run behind a spinner reads as broken; a finished one that keeps
   * polling burns the merchant's battery for nothing.
   */
  useEffect(() => {
    if (!progress?.running) return undefined;

    const timer = setInterval(() => {
      apiFetch<CampaignProgressResponse>(`/campaigns/${campaignId}/progress`)
        .then(setProgress)
        .catch(() => undefined);
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [campaignId, progress?.running]);

  if (loading || !results || !progress) {
    return (
      <Card>
        <SkeletonBodyText lines={8} />
      </Card>
    );
  }

  const done = progress.applied + progress.failed + progress.skipped;
  const totalPages = Math.max(1, Math.ceil(results.totalItems / pageSize));

  return (
    <Page
      title="Campaign results"
      // The way back to the settings, and to Deactivate — without it this
      // screen is a dead end for a campaign that is running right now.
      secondaryActions={
        onOpenCampaign
          ? [
              {
                content: 'Open campaign',
                onAction: () => onOpenCampaign(campaignId),
              },
            ]
          : []
      }
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Something went wrong">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        {progress.running ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingSm">
                {`Updating ${progress.total} variants…`}
              </Text>
              <ProgressBar
                progress={progress.total ? (done / progress.total) * 100 : 0}
                size="small"
              />
              <Text as="p" tone="subdued">
                {`${progress.applied} updated · ${progress.skipped} left alone · ${progress.failed} failed`}
              </Text>
            </BlockStack>
          </Card>
        ) : null}

        {results.failed > 0 ? (
          <Banner
            tone="warning"
            title={`${results.failed} variants could not be updated`}
          >
            <Text as="p">
              Shopify rejected these. The reason is on each row below — usually
              a price it will not accept, or a product that has since changed.
            </Text>
          </Banner>
        ) : null}

        <Card>
          <InlineStack gap="300" wrap>
            <Badge tone="success">{`${results.applied} updated`}</Badge>
            {results.failed > 0 ? (
              <Badge tone="critical">{`${results.failed} failed`}</Badge>
            ) : null}
            {results.skipped > 0 ? (
              <Badge tone="attention">{`${results.skipped} left alone`}</Badge>
            ) : null}
            {results.reverted > 0 ? (
              <Badge>{`${results.reverted} put back`}</Badge>
            ) : null}
          </InlineStack>
        </Card>

        <Card padding="0">
          <IndexTable
            resourceName={{ singular: 'change', plural: 'changes' }}
            itemCount={results.changes.length}
            selectable={false}
            headings={[
              { title: 'Product' },
              { title: 'Was' },
              { title: 'Now' },
              { title: 'Status' },
            ]}
          >
            {results.changes.map((change, index) => (
              <IndexTable.Row
                id={change.id}
                key={change.id}
                position={index}
              >
                <IndexTable.Cell>
                  <BlockStack gap="050">
                    <Text as="span" fontWeight="semibold">
                      {change.productTitle}
                    </Text>
                    <Text as="span" tone="subdued">
                      {change.variantTitle ?? change.shopifyVariantId}
                    </Text>
                  </BlockStack>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  {formatMoney(change.oldPrice, change.currency || currency)}
                </IndexTable.Cell>
                <IndexTable.Cell>
                  {formatMoney(change.newPrice, change.currency || currency)}
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <RowStatus change={change} />
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
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
    </Page>
  );
}

function RowStatus({ change }: { change: PriceChangeDto }) {
  switch (change.status) {
    case PriceChangeStatus.APPLIED:
      return <Badge tone="success">Updated</Badge>;
    case PriceChangeStatus.REVERTED:
      return <Badge>Put back</Badge>;
    case PriceChangeStatus.PENDING:
      return <Badge tone="info">Waiting</Badge>;
    case PriceChangeStatus.FAILED:
    case PriceChangeStatus.SKIPPED:
      return (
        <BlockStack gap="050">
          <Badge
            tone={
              change.status === PriceChangeStatus.FAILED ? 'critical' : 'attention'
            }
          >
            {change.status === PriceChangeStatus.FAILED ? 'Failed' : 'Left alone'}
          </Badge>
          {/* The message is the reason this screen exists. */}
          {change.errorMessage ? (
            <Text as="span" tone="subdued">
              {change.errorMessage}
            </Text>
          ) : null}
        </BlockStack>
      );
    default:
      return <Badge>{change.status}</Badge>;
  }
}
