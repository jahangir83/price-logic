import { useEffect, useState, type ReactElement } from 'react';
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  InlineStack,
  Layout,
  Page,
  Select,
  SkeletonBodyText,
  Text,
  TextField,
} from '@shopify/polaris';
import {
  PricingStrategy,
  SetupStep,
  type StoreSettings,
} from '@pricelogic/shared';
import { ApiError } from '../../api/client';
import { getSettings, markStepSeen, updateSettings } from '../../api/settings';
import { useShop } from '../../app/shop';

const STRATEGY_OPTIONS = [
  { label: 'Percentage markup', value: PricingStrategy.PERCENTAGE_MARKUP },
  { label: 'Fixed markup', value: PricingStrategy.FIXED_MARKUP },
  { label: 'Target margin', value: PricingStrategy.TARGET_MARGIN },
];

/**
 * The shop's pricing defaults.
 *
 * These are never empty. The server fills any missing value from the defaults
 * as it reads them, so this screen always opens on something rather than on a
 * form the merchant has to complete before the app is useful.
 */
export function Settings(): ReactElement {
  const { currency } = useShop();
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;

    getSettings()
      .then((result) => {
        if (!cancelled) setSettings(result);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    // Records the visit for the setup guide. Fire-and-forget on purpose: the
    // merchant came here to change a setting, and a checklist that failed to
    // tick is not worth interrupting them over.
    void markStepSeen(SetupStep.SETTINGS).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  function patch(changes: Partial<StoreSettings>): void {
    setSettings((current) => (current ? { ...current, ...changes } : current));
    setSaved(false);
  }

  async function save(): Promise<void> {
    if (!settings) return;

    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await updateSettings({
        defaultPricingStrategy: settings.defaultPricingStrategy,
        minimumMarginPercent: settings.minimumMarginPercent,
        minimumPrice: settings.minimumPrice,
        maximumPrice: settings.maximumPrice,
        skipOutOfStock: settings.skipOutOfStock,
      });
      setSettings(result);
      setSaved(true);
    } catch (problem) {
      if (problem instanceof ApiError) {
        setError(problem.message);
        setFieldErrors(problem.fieldErrors);
      } else {
        setError('Could not save your settings — please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadFailed) {
    return (
      <Page title="Settings">
        <Banner tone="critical" title="Could not load your settings">
          Nothing has been changed. Reload the page to try again.
        </Banner>
      </Page>
    );
  }

  if (!settings) {
    return (
      <Page title="Settings">
        <Card>
          <SkeletonBodyText lines={6} />
        </Card>
      </Page>
    );
  }

  return (
    <Page title="Settings" subtitle="Defaults applied when you build a campaign">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {error && (
              <Banner tone="critical" title="Could not save">
                {error}
              </Banner>
            )}
            {saved && !error && (
              <Banner tone="success" onDismiss={() => setSaved(false)}>
                Settings saved.
              </Banner>
            )}

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Pricing
                </Text>

                <Select
                  label="Default pricing strategy"
                  helpText="How a new campaign starts out calculating its prices."
                  options={STRATEGY_OPTIONS}
                  value={settings.defaultPricingStrategy}
                  onChange={(value) =>
                    patch({ defaultPricingStrategy: value as PricingStrategy })
                  }
                />

                <TextField
                  label="Minimum margin (%)"
                  type="number"
                  autoComplete="off"
                  min={0}
                  max={99.99}
                  value={String(settings.minimumMarginPercent)}
                  error={fieldErrors.minimumMarginPercent?.[0]}
                  onChange={(value) =>
                    patch({ minimumMarginPercent: Number(value) || 0 })
                  }
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Stock
                </Text>

                <Checkbox
                  label="Do not change the price of out-of-stock products"
                  helpText="A variant with no stock is left at its current price and shown as skipped, whether it is your shop or the supplier that has run out. Turn this off if you want sale prices set before stock arrives."
                  checked={settings.skipOutOfStock}
                  onChange={(value) => patch({ skipOutOfStock: value })}
                />
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Price floor and ceiling
                </Text>

                {/*
                  Money is kept as a string the whole way down, never parsed to
                  a number here and formatted back. That round trip is how a
                  price acquires a rounding error before it is ever stored.
                */}
                <TextField
                  label="Minimum price"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  prefix={currency}
                  helpText="No campaign will price a variant below this. Anything that would is left at its current price and shown as skipped in the preview."
                  value={settings.minimumPrice}
                  error={fieldErrors.minimumPrice?.[0]}
                  onChange={(value) => patch({ minimumPrice: value })}
                />

                <TextField
                  label="Maximum price"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  prefix={currency}
                  placeholder="No maximum"
                  helpText="Leave empty for no ceiling."
                  value={settings.maximumPrice ?? ''}
                  error={fieldErrors.maximumPrice?.[0]}
                  // An empty field means "no ceiling", which the API expects as
                  // an explicit null — undefined would read as "not editing".
                  onChange={(value) =>
                    patch({ maximumPrice: value.trim() === '' ? null : value })
                  }
                />
              </BlockStack>
            </Card>

            <InlineStack align="end">
              <Button variant="primary" loading={saving} onClick={() => void save()}>
                Save
              </Button>
            </InlineStack>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
