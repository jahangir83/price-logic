import { useEffect, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Card,
  Checkbox,
  IndexTable,
  InlineStack,
  Page,
  Pagination,
  SkeletonBodyText,
  Text,
  TextField,
} from '@shopify/polaris';
import {
  CsvRowStatus,
  formatMoney,
  isMoney,
  type CsvImportDto,
  type CsvRowDto,
  type PaginatedResponse,
} from '@pricelogic/shared';
import { ApiError } from '../../api/client';
import {
  approveImport,
  getImport,
  listImportRows,
  overrideImportRow,
} from '../../api/imports';

interface SheetApprovalProps {
  importId: string;
  currency?: string;
  onApproved?: (campaignId: string) => void;
  pageSize?: number;
}

/**
 * The approval screen — the reason this phase exists.
 *
 * Three prices side by side: what the merchant charges now, what the supplier
 * sent, and what it becomes. The last is editable, because a supplier sheet is
 * a proposal and the merchant is the one who decides.
 *
 * Nothing here is trusted. An edited price is revalidated server-side before
 * it is stored, and approving builds the campaign from the stored rows rather
 * than from anything this screen posts back.
 */
export function SheetApproval({
  importId,
  currency = 'USD',
  onApproved,
  pageSize = 25,
}: SheetApprovalProps) {
  const [record, setRecord] = useState<CsvImportDto | null>(null);
  const [rows, setRows] = useState<PaginatedResponse<CsvRowDto> | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      getImport(importId),
      listImportRows(importId, { problemsOnly, page, pageSize }),
    ])
      .then(([loadedImport, loadedRows]) => {
        if (cancelled) return;
        setRecord(loadedImport);
        setRows(loadedRows);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError ? cause.message : 'Could not load the sheet.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [importId, problemsOnly, page, pageSize, reloadToken]);

  const refresh = () => setReloadToken((n) => n + 1);

  const approve = () => {
    setApproving(true);
    approveImport(importId)
      .then((campaign) => onApproved?.(campaign.id))
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Could not approve the sheet.',
        );
      })
      .finally(() => setApproving(false));
  };

  if (loading || !record || !rows) {
    return (
      <Card>
        <SkeletonBodyText lines={8} />
      </Card>
    );
  }

  const problems = record.invalidRows + (record.validRows - record.matchedRows);
  const totalPages = Math.max(1, Math.ceil(rows.totalItems / pageSize));

  return (
    <Page
      title={record.fileName}
      subtitle="Check the prices before they go live"
      primaryAction={{
        content: `Approve ${record.matchedRows} rows`,
        onAction: approve,
        loading: approving,
        disabled: record.matchedRows === 0,
      }}
    >
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Something went wrong">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        <Card>
          <InlineStack gap="300" wrap>
            <Badge tone="success">{`${record.matchedRows} ready to apply`}</Badge>
            {record.invalidRows > 0 ? (
              <Badge tone="critical">{`${record.invalidRows} unreadable`}</Badge>
            ) : null}
            {record.validRows - record.matchedRows > 0 ? (
              <Badge tone="attention">
                {`${record.validRows - record.matchedRows} not found in your store`}
              </Badge>
            ) : null}
            <Badge>{`${record.totalRows} rows in the file`}</Badge>
          </InlineStack>
        </Card>

        {record.matchedRows === 0 ? (
          <Banner tone="warning" title="Nothing in this sheet matched your store">
            <Text as="p">
              None of the SKUs in this file match a product. Check that the SKU
              column is the right one and that it matches how SKUs are written
              in Shopify.
            </Text>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <Checkbox
              label={`Show only rows that need attention (${problems})`}
              checked={problemsOnly}
              onChange={(value) => {
                setProblemsOnly(value);
                setPage(1);
              }}
            />

            <IndexTable
              resourceName={{ singular: 'row', plural: 'rows' }}
              itemCount={rows.items.length}
              selectable={false}
              headings={[
                { title: 'SKU' },
                { title: 'Now' },
                { title: 'From supplier' },
                { title: 'Will become' },
                { title: 'Status' },
              ]}
            >
              {rows.items.map((row, index) => (
                <RowLine
                  key={row.id}
                  row={row}
                  index={index}
                  importId={importId}
                  currency={currency}
                  onSaved={refresh}
                />
              ))}
            </IndexTable>

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
        </Card>
      </BlockStack>
    </Page>
  );
}

function RowLine({
  row,
  index,
  importId,
  currency,
  onSaved,
}: {
  row: CsvRowDto;
  index: number;
  importId: string;
  currency: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(row.approvedPrice ?? '');
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const editable = row.status === CsvRowStatus.MATCHED && !row.excluded;

  const commit = () => {
    const value = draft.trim();
    if (value === (row.approvedPrice ?? '')) return;
    // Checked here for a quick message; the server checks again before storing.
    if (!isMoney(value) || Number(value) <= 0) {
      setFieldError('Enter a price above zero');
      return;
    }
    setFieldError(null);
    setSaving(true);
    overrideImportRow(importId, row.id, { approvedPrice: value })
      .then(onSaved)
      .catch((cause: unknown) => {
        setFieldError(
          cause instanceof ApiError ? cause.message : 'Could not save',
        );
      })
      .finally(() => setSaving(false));
  };

  return (
    <IndexTable.Row id={row.id} position={index} disabled={row.excluded}>
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold">
          {row.sku ?? `Row ${row.rowNumber}`}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {row.currentPrice ? formatMoney(row.currentPrice, currency) : '—'}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {row.sheetPrice ? formatMoney(row.sheetPrice, currency) : '—'}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {editable ? (
          <TextField
            label="Approved price"
            labelHidden
            value={draft}
            onChange={setDraft}
            onBlur={commit}
            autoComplete="off"
            inputMode="decimal"
            disabled={saving}
            error={fieldError ?? undefined}
          />
        ) : (
          '—'
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <StatusCell row={row} />
      </IndexTable.Cell>
    </IndexTable.Row>
  );
}

function StatusCell({ row }: { row: CsvRowDto }) {
  if (row.excluded) return <Badge>Skipped by you</Badge>;

  switch (row.status) {
    case CsvRowStatus.MATCHED:
      return <Badge tone="success">Ready</Badge>;
    case CsvRowStatus.INVALID:
    case CsvRowStatus.UNMATCHED:
      return (
        <BlockStack gap="050">
          <Badge tone={row.status === CsvRowStatus.INVALID ? 'critical' : 'attention'}>
            {row.status === CsvRowStatus.INVALID ? 'Unreadable' : 'Not found'}
          </Badge>
          {/* The message is the point: it tells the merchant what to fix. */}
          {row.errorMessage ? (
            <Text as="span" tone="subdued">
              {row.errorMessage}
            </Text>
          ) : null}
        </BlockStack>
      );
    default:
      return <Badge>Checking</Badge>;
  }
}
