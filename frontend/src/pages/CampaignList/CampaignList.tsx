import { useEffect, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  Page,
  Pagination,
  SkeletonBodyText,
  Tabs,
  Text,
} from '@shopify/polaris';
import {
  CampaignPriceSource,
  CampaignStatus,
  type CampaignDto,
  type PaginatedResponse,
} from '@pricelogic/shared';
import { ApiError } from '../../api/client';
import { listCampaigns } from '../../api/campaigns';

interface CampaignListProps {
  /**
   * Hands over the whole campaign, not just its id: a campaign that has not run
   * yet opens onto a different screen than one that has, and the row already
   * knows which this is. An id alone would make the caller fetch back what was
   * on screen a moment ago.
   */
  onOpen?: (campaign: CampaignDto) => void;
  onCreate?: () => void;
  pageSize?: number;
}

/** The filters a merchant actually uses, in the order they use them. */
const TABS: { id: string; content: string; status?: CampaignStatus }[] = [
  { id: 'all', content: 'All' },
  { id: 'active', content: 'Running', status: CampaignStatus.ACTIVE },
  { id: 'scheduled', content: 'Scheduled', status: CampaignStatus.SCHEDULED },
  { id: 'draft', content: 'Drafts', status: CampaignStatus.DRAFT },
  { id: 'done', content: 'Finished', status: CampaignStatus.COMPLETED },
];

/** The app's home screen. */
export function CampaignList({
  onOpen,
  onCreate,
  pageSize = 25,
}: CampaignListProps) {
  const [data, setData] = useState<PaginatedResponse<CampaignDto> | null>(null);
  const [tabIndex, setTabIndex] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const status = TABS[tabIndex]?.status;

  useEffect(() => {
    let cancelled = false;

    listCampaigns({ status, page })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError ? cause.message : 'Could not load campaigns.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [status, page]);

  const totalPages = Math.max(1, Math.ceil((data?.totalItems ?? 0) / pageSize));

  return (
    <Page
      title="Campaigns"
      primaryAction={{ content: 'Create campaign', onAction: () => onCreate?.() }}
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not load campaigns">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        <Card padding="0">
          <Tabs
            tabs={TABS.map(({ id, content }) => ({ id, content }))}
            selected={tabIndex}
            onSelect={(index) => {
              setTabIndex(index);
              setPage(1);
            }}
          />

          {loading || !data ? (
            <div style={{ padding: 'var(--p-space-400)' }}>
              <SkeletonBodyText lines={6} />
            </div>
          ) : data.items.length === 0 ? (
            <EmptyState
              heading="No campaigns here yet"
              action={{ content: 'Create campaign', onAction: () => onCreate?.() }}
              image=""
            >
              <Text as="p">
                A campaign changes prices across the products you choose, and
                puts them back when it ends.
              </Text>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: 'campaign', plural: 'campaigns' }}
              itemCount={data.items.length}
              selectable={false}
              headings={[
                { title: 'Campaign' },
                { title: 'Status' },
                { title: 'Prices from' },
                { title: 'Runs' },
              ]}
            >
              {data.items.map((campaign, index) => (
                <IndexTable.Row
                  id={campaign.id}
                  key={campaign.id}
                  position={index}
                  onClick={() => onOpen?.(campaign)}
                >
                  <IndexTable.Cell>
                    <Text as="span" fontWeight="semibold">
                      {campaign.title}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <StatusBadge status={campaign.status} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {campaign.priceSource === CampaignPriceSource.SHEET
                      ? 'Supplier sheet'
                      : 'Current prices'}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Schedule campaign={campaign} />
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
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

function StatusBadge({ status }: { status: CampaignStatus }) {
  switch (status) {
    case CampaignStatus.ACTIVE:
      return <Badge tone="success">Running</Badge>;
    case CampaignStatus.SCHEDULED:
      return <Badge tone="info">Scheduled</Badge>;
    case CampaignStatus.FAILED:
      return <Badge tone="critical">Needs attention</Badge>;
    case CampaignStatus.COMPLETED:
      return <Badge>Finished</Badge>;
    case CampaignStatus.CANCELLED:
      return <Badge>Cancelled</Badge>;
    default:
      return <Badge tone="attention">Draft</Badge>;
  }
}

function Schedule({ campaign }: { campaign: CampaignDto }) {
  if (!campaign.startAt) {
    return (
      <Text as="span" tone="subdued">
        When you start it
      </Text>
    );
  }

  const start = new Date(campaign.startAt).toLocaleDateString();
  if (!campaign.endAt) {
    // Worth saying plainly — this is the setting merchants ask about most.
    return (
      <Text as="span">
        {start} — until you stop it
      </Text>
    );
  }
  return (
    <Text as="span">{`${start} — ${new Date(campaign.endAt).toLocaleDateString()}`}</Text>
  );
}
