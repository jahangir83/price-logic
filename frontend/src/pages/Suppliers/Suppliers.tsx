import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Card,
  EmptyState,
  InlineStack,
  Layout,
  Modal,
  Page,
  ResourceItem,
  ResourceList,
  SkeletonBodyText,
  Text,
  TextField,
} from '@shopify/polaris';
import { SupplierStatus, type SupplierDto } from '@pricelogic/shared';
import { ApiError } from '../../api/client';
import {
  createSupplier,
  listSuppliers,
  removeSupplier,
  updateSupplier,
} from '../../api/suppliers';

/**
 * Who sends the sheets.
 *
 * Identity only — a name and an optional code. There are no costs, no terms
 * and no integration here, because the sheet carries final prices and the
 * campaign's own adjustment goes on top. Anything more would be a field
 * nothing reads.
 */
export function Suppliers(): ReactElement {
  const [suppliers, setSuppliers] = useState<SupplierDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SupplierDto | 'new' | null>(null);

  const load = useCallback(() => {
    listSuppliers()
      .then((result) => setSuppliers(result.items))
      .catch(() => setError('Could not load your suppliers.'));
  }, []);

  useEffect(load, [load]);

  const toggleStatus = useCallback(
    async (supplier: SupplierDto) => {
      const next =
        supplier.status === SupplierStatus.ACTIVE
          ? SupplierStatus.INACTIVE
          : SupplierStatus.ACTIVE;
      try {
        await updateSupplier(supplier.id, { status: next });
        load();
      } catch {
        setError('Could not change that supplier.');
      }
    },
    [load],
  );

  const remove = useCallback(
    async (supplier: SupplierDto) => {
      try {
        await removeSupplier(supplier.id);
        load();
      } catch {
        setError('Could not remove that supplier.');
      }
    },
    [load],
  );

  if (!suppliers && !error) {
    return (
      <Page title="Suppliers">
        <Card>
          <SkeletonBodyText lines={5} />
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Suppliers"
      subtitle="Who sends you price sheets"
      primaryAction={{
        content: 'Add supplier',
        onAction: () => setEditing('new'),
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

            {suppliers?.length === 0 ? (
              <Card>
                <EmptyState
                  heading="Add the first supplier"
                  action={{
                    content: 'Add supplier',
                    onAction: () => setEditing('new'),
                  }}
                  image=""
                >
                  <p>
                    A supplier is just a name to file price sheets under. You
                    need one before you can upload a sheet.
                  </p>
                </EmptyState>
              </Card>
            ) : (
              <Card padding="0">
                <ResourceList
                  resourceName={{
                    singular: 'supplier',
                    plural: 'suppliers',
                  }}
                  items={suppliers ?? []}
                  renderItem={(supplier) => (
                    <ResourceItem
                      id={supplier.id}
                      onClick={() => setEditing(supplier)}
                      shortcutActions={[
                        {
                          content:
                            supplier.status === SupplierStatus.ACTIVE
                              ? 'Deactivate'
                              : 'Activate',
                          onAction: () => void toggleStatus(supplier),
                        },
                        {
                          content: 'Remove',
                          onAction: () => void remove(supplier),
                        },
                      ]}
                    >
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" fontWeight="semibold">
                          {supplier.name}
                        </Text>
                        {supplier.code && (
                          <Text as="span" tone="subdued">
                            {supplier.code}
                          </Text>
                        )}
                        {supplier.status === SupplierStatus.INACTIVE && (
                          <Badge tone="attention">Inactive</Badge>
                        )}
                      </InlineStack>
                    </ResourceItem>
                  )}
                />
              </Card>
            )}

            {/*
              Said plainly because "Remove" that leaves the name visible looks
              like the app ignored the click. It did not — the sheets this
              supplier sent still reference it, and a history that loses the
              sender is not a history.
            */}
            <Text as="p" tone="subdued" variant="bodySm">
              Removing a supplier hides it from this list. Sheets they already
              sent keep their name.
            </Text>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {editing && (
        <SupplierModal
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </Page>
  );
}

function SupplierModal({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: SupplierDto | null;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const [name, setName] = useState(supplier?.name ?? '');
  const [code, setCode] = useState(supplier?.code ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const body = { name: name.trim(), code: code.trim() || null };
      if (supplier) {
        await updateSupplier(supplier.id, body);
      } else {
        await createSupplier(body);
      }
      onSaved();
    } catch (problem) {
      setError(
        problem instanceof ApiError
          ? problem.message
          : 'Could not save that supplier.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={supplier ? 'Edit supplier' : 'Add supplier'}
      primaryAction={{
        content: 'Save',
        loading: saving,
        disabled: name.trim() === '',
        onAction: () => void save(),
      }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {error && <Banner tone="critical">{error}</Banner>}
          <TextField
            label="Name"
            autoComplete="organization"
            value={name}
            onChange={setName}
          />
          <TextField
            label="Code"
            autoComplete="off"
            helpText="Optional. Your own shorthand — it does not have to be unique."
            value={code}
            onChange={setCode}
          />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
