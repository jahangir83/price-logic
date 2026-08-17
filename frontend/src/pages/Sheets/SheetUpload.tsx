import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DropZone,
  InlineStack,
  Layout,
  Page,
  ProgressBar,
  Select,
  Text,
} from '@shopify/polaris';
import {
  CSV_COLUMN_ALIASES,
  CSV_COLUMN_HELP,
  CsvImportStatus,
  REQUIRED_CSV_COLUMNS,
  SupplierStatus,
  buildExampleSheet,
  type CsvColumn,
  type CsvImportDto,
  type SupplierDto,
} from '@pricelogic/shared';
import { ApiError } from '../../api/client';
import { getImport, uploadSheet } from '../../api/imports';
import { listSuppliers } from '../../api/suppliers';

/** How often to ask whether parsing has finished. */
const POLL_MS = 1500;

/**
 * Give the sheet up, and wait for it.
 *
 * The upload endpoint returns the moment the file is stored — parsing and
 * matching run as jobs, because a 30,000-row sheet takes longer than a proxy
 * will hold a connection open. So the interesting part of this screen is not
 * the upload, it is the wait: an upload that appears to do nothing for thirty
 * seconds reads as a failure, and a merchant who reads it that way uploads the
 * file again.
 */
type Phase =
  | { name: 'choosing' }
  | { name: 'uploading' }
  | { name: 'working'; record: CsvImportDto }
  | { name: 'failed'; message: string };

export function SheetUpload(): ReactElement {
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<SupplierDto[] | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'choosing' });

  useEffect(() => {
    listSuppliers({ status: SupplierStatus.ACTIVE })
      .then((result) => {
        setSuppliers(result.items);
        setSupplierId((current) => current || (result.items[0]?.id ?? ''));
      })
      .catch(() =>
        setPhase({
          name: 'failed',
          message: 'Could not load your suppliers.',
        }),
      );
  }, []);

  const upload = useCallback(async () => {
    if (!file || !supplierId) return;
    setPhase({ name: 'uploading' });
    try {
      const record = await uploadSheet(supplierId, file);
      setPhase({ name: 'working', record });
    } catch (problem) {
      setPhase({
        name: 'failed',
        message:
          problem instanceof ApiError
            ? problem.message
            : 'The file could not be uploaded.',
      });
    }
  }, [file, supplierId]);

  const importId = phase.name === 'working' ? phase.record.id : null;

  usePoll(importId, POLL_MS, (record) => {
    if (record.status === CsvImportStatus.READY) {
      // Straight to approval: the merchant uploaded this to review it, and an
      // intermediate "done" screen is a click between them and the thing they
      // came for.
      navigate(`/imports/${record.id}`, { replace: true });
      return;
    }
    if (record.status === CsvImportStatus.FAILED) {
      setPhase({
        name: 'failed',
        message: record.errorMessage ?? 'That file could not be read.',
      });
      return;
    }
    setPhase({ name: 'working', record });
  });

  if (suppliers?.length === 0) {
    return (
      <Page title="Upload a price sheet">
        <Banner
          tone="warning"
          title="Add a supplier first"
          action={{
            content: 'Go to suppliers',
            onAction: () => navigate('/suppliers'),
          }}
        >
          A sheet is filed under the supplier who sent it, so there needs to be
          one before you can upload.
        </Banner>
      </Page>
    );
  }

  return (
    <Page
      title="Upload a price sheet"
      backAction={{ content: 'Sheets', onAction: () => navigate('/sheets') }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {phase.name === 'failed' && (
              <Banner
                tone="critical"
                title="That did not work"
                action={{
                  content: 'Try again',
                  onAction: () => setPhase({ name: 'choosing' }),
                }}
              >
                {phase.message}
              </Banner>
            )}

            {phase.name !== 'working' && <SheetFormat />}

            {phase.name === 'working' ? (
              <Working record={phase.record} />
            ) : (
              <Card>
                <BlockStack gap="400">
                  <Select
                    label="Supplier"
                    options={(suppliers ?? []).map((supplier) => ({
                      label: supplier.name,
                      value: supplier.id,
                    }))}
                    value={supplierId}
                    onChange={setSupplierId}
                    disabled={phase.name === 'uploading'}
                  />

                  <DropZone
                    accept=".csv,text/csv"
                    type="file"
                    allowMultiple={false}
                    onDrop={(_files, accepted) => setFile(accepted[0] ?? null)}
                  >
                    {file ? (
                      <BlockStack gap="100" inlineAlign="center">
                        <Text as="p" fontWeight="semibold">
                          {file.name}
                        </Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          {Math.max(1, Math.round(file.size / 1024))} KB
                        </Text>
                      </BlockStack>
                    ) : (
                      <DropZone.FileUpload actionHint="Accepts .csv up to 10MB" />
                    )}
                  </DropZone>

                  <InlineStack align="end">
                    <Button
                      variant="primary"
                      loading={phase.name === 'uploading'}
                      disabled={!file || !supplierId}
                      onClick={() => void upload()}
                    >
                      Upload
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Working({ record }: { record: CsvImportDto }): ReactElement {
  const parsed = record.totalRows > 0;

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          Reading {record.fileName}
        </Text>

        {/*
          Indeterminate until the parser has counted the rows, because it
          cannot know the total before it has read the file. A bar that sits at
          0% is worse than one that moves without a number.
        */}
        <ProgressBar progress={parsed ? 66 : 25} size="small" />

        <Text as="p" tone="subdued">
          {parsed
            ? `${record.totalRows.toLocaleString()} rows found. Matching them to products in your store — this can take a minute on a large sheet.`
            : 'Reading the file. This usually takes a few seconds.'}
        </Text>

        <Text as="p" tone="subdued" variant="bodySm">
          You can leave this page. The sheet will be waiting under Sheets when
          it is done.
        </Text>
      </BlockStack>
    </Card>
  );
}

/**
 * Polls one import until the caller stops caring.
 *
 * The timer is cleared on unmount and the in-flight answer discarded, so a
 * merchant who navigates away mid-parse does not get a redirect landing on
 * whatever they opened instead.
 */
function usePoll(
  importId: string | null,
  intervalMs: number,
  onTick: (record: CsvImportDto) => void,
): void {
  // Held in a ref so changing the callback does not restart the interval —
  // `onTick` is redefined on every render, and a fresh timer each time would
  // poll far faster than intended. Assigned in an effect rather than during
  // render: a ref written while rendering is a side effect, and React may
  // discard that render without ever committing it.
  const callback = useRef(onTick);
  useEffect(() => {
    callback.current = onTick;
  });

  useEffect(() => {
    if (!importId) return;

    let cancelled = false;
    const timer = setInterval(() => {
      getImport(importId)
        .then((record) => {
          if (!cancelled) callback.current(record);
        })
        .catch(() => {
          // A single failed poll is not worth reporting — the next one is a
          // second and a half away, and the job is still running regardless.
        });
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [importId, intervalMs]);
}

/**
 * What the file has to look like, and one they can copy.
 *
 * Both are built from `CSV_COLUMN_ALIASES` rather than written out here. A
 * hand-maintained example is a second source of truth about the file format,
 * and the day somebody adds an alias it starts quietly lying — a merchant would
 * follow it, get a rejected file, and have no way to see why.
 */
function SheetFormat(): ReactElement {
  const columns = Object.keys(CSV_COLUMN_ALIASES) as CsvColumn[];

  function download(): void {
    // Built in the browser rather than fetched: the content is derived from
    // code the bundle already contains, so a round trip would only add a way
    // for it to fail.
    const blob = new Blob([buildExampleSheet()], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pricelogic-example-sheet.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <Text as="h2" variant="headingMd">
            What the sheet needs
          </Text>
          <Button onClick={download}>Download example</Button>
        </InlineStack>

        <Text as="p" tone="subdued">
          A row per product. Prices are the price you want to sell at, not a
          cost — there is no margin calculation, and your campaign’s own
          adjustment applies on top of whatever is here.
        </Text>

        <BlockStack gap="300">
          {columns.map((column) => (
            <BlockStack gap="100" key={column}>
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" fontWeight="semibold">
                  {CSV_COLUMN_ALIASES[column][0]}
                </Text>
                {REQUIRED_CSV_COLUMNS.includes(column) ? (
                  <Badge tone="info">Required</Badge>
                ) : (
                  <Badge>Optional</Badge>
                )}
              </InlineStack>
              <Text as="p" tone="subdued" variant="bodySm">
                {CSV_COLUMN_HELP[column]}
              </Text>
              {/*
                The aliases are worth showing. A supplier who sends "MSRP" has
                sent a valid sheet, and a merchant who does not know that will
                rename the column by hand every month.
              */}
              <Text as="p" tone="subdued" variant="bodySm">
                Also accepted:{' '}
                {CSV_COLUMN_ALIASES[column].slice(1).join(', ') || '—'}
              </Text>
            </BlockStack>
          ))}
        </BlockStack>

        <Text as="p" tone="subdued" variant="bodySm">
          Header spelling is forgiving — case, spaces and underscores are
          ignored, so “Compare At Price” and “compare_at_price” both work.
        </Text>
      </BlockStack>
    </Card>
  );
}
