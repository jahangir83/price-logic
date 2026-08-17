import { useEffect, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Card,
  Checkbox,
  IndexTable,
  InlineStack,
  Select,
  Page,
  Pagination,
  SkeletonBodyText,
  Text,
  TextField,
} from '@shopify/polaris';
import {
  CsvRowSort,
  MatchStrategy,
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
  const [sort, setSort] = useState<CsvRowSort>(CsvRowSort.CHANGE);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      getImport(importId),
      listImportRows(importId, { problemsOnly, sort, page, pageSize }),
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
  }, [importId, problemsOnly, sort, page, pageSize, reloadToken]);

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
            <InlineStack align="space-between" blockAlign="center" wrap={false}>
              <Checkbox
                label={`Show only rows that need attention (${problems})`}
                checked={problemsOnly}
                onChange={(value) => {
                  setProblemsOnly(value);
                  setPage(1);
                }}
              />

              {/*
                Biggest movers first by default. Reviewing a supplier sheet is
                looking for the prices that moved, and file order buries four
                30% rises among nine hundred that did not change. Sorted on the
                server, because sorting the page you happen to be on is not
                sorting the sheet.
              */}
              <Select
                label="Sort by"
                labelInline
                options={[
                  { label: 'Biggest change', value: CsvRowSort.CHANGE },
                  { label: 'Sheet order', value: CsvRowSort.SHEET },
                ]}
                value={sort}
                onChange={(value) => {
                  setSort(value as CsvRowSort);
                  setPage(1);
                }}
              />
            </InlineStack>

            <IndexTable
              resourceName={{ singular: 'row', plural: 'rows' }}
              itemCount={rows.items.length}
              selectable={false}
              headings={[
                { title: 'Product' },
                { title: 'Now' },
                { title: 'From supplier' },
                { title: 'Change' },
                { title: 'Stock' },
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
      {/*
        The product, not just its code. A dropshipper reviewing four hundred
        rows can see that AC-9912-BLK is going from 14 to 17 and has no idea
        what it is; the SKU stays underneath because it is what the row was
        matched on and what they will search their supplier's sheet by.
      */}
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" fontWeight="semibold">
            {row.productTitle ?? row.sku ?? `Row ${row.rowNumber}`}
          </Text>
          <InlineStack gap="150" blockAlign="center" wrap={false}>
            <Text as="span" tone="subdued" variant="bodySm">
              {[row.variantTitle, row.sku].filter(Boolean).join(' · ') ||
                `Row ${row.rowNumber}`}
            </Text>
            <MatchedByTag matchedBy={row.matchedBy} />
          </InlineStack>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {row.currentPrice ? formatMoney(row.currentPrice, currency) : '—'}
      </IndexTable.Cell>
      <IndexTable.Cell>
        {row.sheetPrice ? formatMoney(row.sheetPrice, currency) : '—'}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <PriceChange
          from={row.currentPrice}
          to={row.approvedPrice ?? row.sheetPrice}
        />
      </IndexTable.Cell>
      <IndexTable.Cell>
        <StockCell row={row} />
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

/**
 * How far this price moves, and which way.
 *
 * The three price columns beside it are the raw facts; this is the one the
 * merchant is actually scanning for. Reviewing a supplier sheet means finding
 * the prices that moved and deciding whether to follow — leaving them to
 * subtract four hundred pairs of numbers is leaving them to skim, and skimming
 * is how a 30% rise gets approved.
 *
 * Percentage as well as amount, because neither alone is enough: 50p is
 * nothing on a sofa and a third of the price of a mug.
 */
function PriceChange({
  from,
  to,
}: {
  from: string | null;
  to: string | null;
}) {
  if (!from || !to) return <Text as="span" tone="subdued">—</Text>;

  // Compared as numbers, which is safe here and only here: this is a label,
  // never an input to a price that gets written. Every stored and submitted
  // value stays the decimal string it arrived as.
  const before = Number(from);
  const after = Number(to);
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) {
    return <Text as="span" tone="subdued">—</Text>;
  }

  const delta = after - before;
  if (Math.abs(delta) < 0.005) {
    return (
      <Text as="span" tone="subdued">
        No change
      </Text>
    );
  }

  const percent = (delta / before) * 100;
  const rising = delta > 0;

  return (
    <Text as="span" tone={rising ? 'caution' : 'success'}>
      {rising ? '↑' : '↓'} {Math.abs(percent).toFixed(1)}%
    </Text>
  );
}

/**
 * What is in stock, on whichever side said so.
 *
 * Both numbers are shown when both are known, because they answer different
 * questions — the supplier's is "can I get more", the shop's is "have I any
 * left" — and a merchant deciding whether to promote something needs both.
 *
 * A dash means nobody said. That is deliberately not the same as zero, and it
 * is why the column can look empty on a sheet with no stock column and a shop
 * that does not track inventory.
 */
function StockCell({ row }: { row: CsvRowDto }) {
  const supplier = row.sheetStock;
  const shop = row.stockQuantity;

  if (supplier === null && shop === null) {
    return (
      <Text as="span" tone="subdued">
        —
      </Text>
    );
  }

  const out =
    (typeof supplier === 'number' && supplier <= 0) ||
    (typeof shop === 'number' && shop <= 0);

  return (
    <BlockStack gap="050">
      <Text as="span" tone={out ? 'critical' : undefined}>
        {shop !== null ? `${shop} in store` : '— in store'}
      </Text>
      {supplier !== null && (
        <Text as="span" tone="subdued" variant="bodySm">
          {supplier} at supplier
        </Text>
      )}
    </BlockStack>
  );
}

/**
 * How this row was found, when it was not found the ordinary way.
 *
 * Silent for a plain SKU match, which is the overwhelming majority and needs no
 * comment. The other two rungs are worth flagging: they mean the merchant's own
 * SKU did not match, so the row is a correct-looking price change resting on a
 * weaker identification — exactly the kind worth a second look before approving
 * four hundred of them.
 */
function MatchedByTag({ matchedBy }: { matchedBy: MatchStrategy | null }) {
  if (matchedBy === null || matchedBy === MatchStrategy.SKU) return null;

  const label =
    matchedBy === MatchStrategy.BARCODE
      ? 'Matched by barcode'
      : 'Matched by supplier SKU';

  return <Badge tone="info">{label}</Badge>;
}

function StatusCell({ row }: { row: CsvRowDto }) {
  if (row.excluded) return <Badge>Skipped by you</Badge>;

  // Said on the row itself, not only in a total above the table. A merchant
  // who sees "380 of 500 will update" needs to find the 120, and scrolling for
  // rows that look subtly different is not finding them.
  if (
    row.status === CsvRowStatus.MATCHED &&
    ((typeof row.sheetStock === 'number' && row.sheetStock <= 0) ||
      (typeof row.stockQuantity === 'number' && row.stockQuantity <= 0))
  ) {
    return <Badge tone="attention">Out of stock — not updating</Badge>;
  }

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
