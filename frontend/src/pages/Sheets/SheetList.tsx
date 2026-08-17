import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Banner,
  BlockStack,
  Card,
  EmptyState,
  IndexTable,
  Layout,
  Page,
  Pagination,
  SkeletonBodyText,
  Text,
} from '@shopify/polaris';
import {
  CsvImportStatus,
  type CsvImportDto,
  type PaginatedResponse,
  type SupplierDto,
} from '@pricelogic/shared';
import { listImports } from '../../api/imports';
import { listSuppliers } from '../../api/suppliers';

/**
 * Every sheet this shop has uploaded.
 *
 * The reason it exists: an import is otherwise reachable only by its id, which
 * the merchant never sees. Without this, a sheet uploaded yesterday — and any
 * campaign still waiting on it — is simply lost.
 */
export function SheetList(): ReactElement {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedResponse<CsvImportDto> | null>(null);
  const [suppliers, setSuppliers] = useState<Map<string, SupplierDto>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listImports({ page })
      .then(setData)
      .catch(() => setError('Could not load your sheets.'));
  }, [page]);

  useEffect(load, [load]);

  useEffect(() => {
    // Names, so the table does not show a column of UUIDs. Failing is survivable
    // — the sheet's own filename still identifies it.
    listSuppliers()
      .then((result) =>
        setSuppliers(new Map(result.items.map((item) => [item.id, item]))),
      )
      .catch(() => undefined);
  }, []);

  if (!data && !error) {
    return (
      <Page title="Price sheets">
        <Card>
          <SkeletonBodyText lines={6} />
        </Card>
      </Page>
    );
  }

  const items = data?.items ?? [];

  return (
    <Page
      title="Price sheets"
      subtitle="Supplier sheets you have uploaded"
      primaryAction={{
        content: 'Upload sheet',
        onAction: () => navigate('/sheets/new'),
      }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical" onDismiss={() => setError(null)}>
                {error}
              </Banner>
            )}

            {items.length === 0 ? (
              <Card>
                <EmptyState
                  heading="No sheets yet"
                  action={{
                    content: 'Upload sheet',
                    onAction: () => navigate('/sheets/new'),
                  }}
                  image=""
                >
                  <p>
                    Upload a supplier’s price list and review every price before
                    any of it reaches your store.
                  </p>
                </EmptyState>
              </Card>
            ) : (
              <Card padding="0">
                <IndexTable
                  resourceName={{ singular: 'sheet', plural: 'sheets' }}
                  itemCount={items.length}
                  selectable={false}
                  headings={[
                    { title: 'File' },
                    { title: 'Supplier' },
                    { title: 'Status' },
                    { title: 'Rows' },
                    { title: 'Matched' },
                  ]}
                >
                  {items.map((record, index) => (
                    <IndexTable.Row
                      id={record.id}
                      key={record.id}
                      position={index}
                      onClick={() => navigate(`/imports/${record.id}`)}
                    >
                      <IndexTable.Cell>
                        <Text as="span" fontWeight="semibold">
                          {record.fileName}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {suppliers.get(record.supplierId)?.name ?? '—'}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <StatusBadge record={record} />
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {record.totalRows.toLocaleString()}
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        {record.matchedRows.toLocaleString()}
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              </Card>
            )}

            {data && data.totalPages > 1 && (
              <Pagination
                hasPrevious={page > 1}
                hasNext={page < data.totalPages}
                onPrevious={() => setPage((current) => current - 1)}
                onNext={() => setPage((current) => current + 1)}
                label={`Page ${data.page} of ${data.totalPages}`}
              />
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function StatusBadge({ record }: { record: CsvImportDto }): ReactElement {
  switch (record.status) {
    case CsvImportStatus.READY:
      // The one that is asking for something. Invalid rows are worth showing
      // here rather than only inside — it is why a merchant opens the sheet.
      return (
        <Badge tone="attention">
          {record.invalidRows > 0
            ? `Needs review · ${record.invalidRows} problem${record.invalidRows === 1 ? '' : 's'}`
            : 'Needs review'}
        </Badge>
      );
    case CsvImportStatus.APPROVED:
      return <Badge tone="success">Approved</Badge>;
    case CsvImportStatus.FAILED:
      return <Badge tone="critical">Failed</Badge>;
    default:
      return <Badge progress="incomplete">Reading</Badge>;
  }
}
