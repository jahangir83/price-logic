import { useCallback, useState, type KeyboardEvent } from 'react';
import {
  Banner,
  BlockStack,
  Card,
  Checkbox,
  FormLayout,
  InlineGrid,
  Layout,
  Page,
  Select,
  Tag,
  TextField,
  Text,
  InlineStack,
} from '@shopify/polaris';
import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignBasis,
} from '@pricelogic/shared';
import { ApiError } from '../../api/client';
import { createCampaign } from '../../api/campaigns';
import { SummaryPanel } from './SummaryPanel';
import { TargetingSection } from './TargetingSection';
import {
  emptyCampaignForm,
  toRequest,
  validateForm,
  type CampaignFormState,
} from './campaignFormState';

interface CampaignFormProps {
  currency?: string;
  onSaved?: (campaignId: string) => void;
}

/**
 * The campaign builder.
 *
 * Saves as DRAFT. Activating is a separate, explicit action — a merchant
 * filling in a form has not yet decided to change every price in their store,
 * and Phase 6 owns the step that does.
 */
export function CampaignForm({ currency = 'USD', onSaved }: CampaignFormProps) {
  const [form, setForm] = useState<CampaignFormState>(emptyCampaignForm);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

  const patch = useCallback((changes: Partial<CampaignFormState>) => {
    setForm((previous) => ({ ...previous, ...changes }));
  }, []);

  const save = useCallback(async () => {
    const problem = validateForm(form);
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const campaign = await createCampaign(toRequest(form));
      onSaved?.(campaign.id);
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fieldErrors);
      } else {
        setError('Could not save the campaign.');
      }
    } finally {
      setSaving(false);
    }
  }, [form, onSaved]);

  const fieldError = (field: string): string | undefined =>
    fieldErrors[field]?.[0];

  return (
    <Page
      title="New campaign"
      primaryAction={{
        content: 'Save as draft',
        onAction: () => void save(),
        loading: saving,
      }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {error ? (
              <Banner tone="critical" title="Check the campaign">
                <Text as="p">{error}</Text>
              </Banner>
            ) : null}

            <Card>
              <FormLayout>
                <TextField
                  label="Campaign name"
                  value={form.title}
                  onChange={(title) => patch({ title })}
                  autoComplete="off"
                  error={fieldError('title')}
                  helpText="Only you see this — it does not appear on the storefront."
                />
              </FormLayout>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Price change
                </Text>

                <Checkbox
                  label="Change prices"
                  helpText="Turn this off to only add or remove tags."
                  checked={form.adjustmentEnabled}
                  onChange={(adjustmentEnabled) => patch({ adjustmentEnabled })}
                />

                {form.adjustmentEnabled ? (
                  <FormLayout>
                    <FormLayout.Group>
                      <Select
                        label="Direction"
                        options={[
                          {
                            label: 'Decrease',
                            value: CampaignAdjustmentDirection.DECREASE,
                          },
                          {
                            label: 'Increase',
                            value: CampaignAdjustmentDirection.INCREASE,
                          },
                        ]}
                        value={form.adjustmentDirection}
                        onChange={(value) =>
                          patch({
                            adjustmentDirection:
                              value as CampaignAdjustmentDirection,
                          })
                        }
                      />
                      <Select
                        label="By"
                        options={[
                          {
                            label: 'Percentage',
                            value: CampaignAdjustmentUnit.PERCENTAGE,
                          },
                          {
                            label: 'Fixed amount',
                            value: CampaignAdjustmentUnit.FIXED_AMOUNT,
                          },
                        ]}
                        value={form.adjustmentUnit}
                        onChange={(value) =>
                          patch({
                            adjustmentUnit: value as CampaignAdjustmentUnit,
                          })
                        }
                      />
                      <TextField
                        label="Amount"
                        value={form.adjustmentValue}
                        onChange={(adjustmentValue) => patch({ adjustmentValue })}
                        autoComplete="off"
                        inputMode="decimal"
                        suffix={
                          form.adjustmentUnit ===
                          CampaignAdjustmentUnit.PERCENTAGE
                            ? '%'
                            : currency
                        }
                        error={fieldError('adjustmentValue')}
                      />
                    </FormLayout.Group>

                    <Select
                      label="Calculate from"
                      options={[
                        { label: 'Current price', value: CampaignBasis.PRICE },
                        {
                          label: 'Compare-at price',
                          value: CampaignBasis.COMPARE_AT_PRICE,
                        },
                      ]}
                      value={form.basis}
                      onChange={(value) =>
                        patch({ basis: value as CampaignBasis })
                      }
                      helpText="Compare-at is useful for discounting from the original price rather than a price already on sale."
                    />
                  </FormLayout>
                ) : null}

                <Checkbox
                  label="Round prices"
                  checked={form.roundingEnabled}
                  onChange={(roundingEnabled) => patch({ roundingEnabled })}
                />

                {form.roundingEnabled ? (
                  <FormLayout.Group>
                    <TextField
                      label="End prices in"
                      value={form.roundTo}
                      onChange={(roundTo) => patch({ roundTo })}
                      autoComplete="off"
                      inputMode="decimal"
                      prefix="."
                      helpText="For example 0.99 makes 10.20 into 10.99."
                    />
                    <Select
                      label="Round"
                      options={[
                        { label: 'Up', value: 'UP' },
                        { label: 'Down', value: 'DOWN' },
                        { label: 'Nearest', value: 'NEAREST' },
                      ]}
                      value={form.roundStrategy}
                      onChange={(value) =>
                        patch({
                          roundStrategy: value as 'UP' | 'DOWN' | 'NEAREST',
                        })
                      }
                    />
                  </FormLayout.Group>
                ) : null}

                <Checkbox
                  label="Show the old price struck through"
                  helpText="Moves the current price into compare-at so customers see the saving."
                  checked={form.setCompareAt}
                  onChange={(setCompareAt) => patch({ setCompareAt })}
                />
              </BlockStack>
            </Card>

            <TargetingSection form={form} onChange={patch} />

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Tags
                </Text>
                <TagEditor
                  label="Add these tags while the campaign runs"
                  values={form.addTags}
                  onChange={(addTags) => patch({ addTags })}
                />
                <TagEditor
                  label="Remove these tags while it runs"
                  values={form.removeTags}
                  onChange={(removeTags) => patch({ removeTags })}
                />
                <Text as="p" tone="subdued">
                  Both are put back exactly as they were when the campaign ends.
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Schedule
                </Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Starts"
                      type="datetime-local"
                      value={form.startAt}
                      onChange={(startAt) => patch({ startAt })}
                      autoComplete="off"
                      helpText="Leave empty to start it yourself."
                    />
                    <TextField
                      label="Start time zone"
                      value={form.startTimezone}
                      onChange={(startTimezone) => patch({ startTimezone })}
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField
                      label="Ends"
                      type="datetime-local"
                      value={form.endAt}
                      onChange={(endAt) => patch({ endAt })}
                      autoComplete="off"
                      helpText="Leave empty and it runs until you stop it."
                    />
                    <TextField
                      label="End time zone"
                      value={form.endTimezone}
                      onChange={(endTimezone) => patch({ endTimezone })}
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                </FormLayout>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <SummaryPanel form={form} currency={currency} />
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function TagEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const tag = draft.trim();
    // Case-insensitive, because Shopify treats tags that way and "Sale" twice
    // in different cases is one tag as far as the storefront is concerned.
    if (!tag || values.some((v) => v.toLowerCase() === tag.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...values, tag]);
    setDraft('');
  };

  return (
    <BlockStack gap="200">
      {/* Polaris TextField has no onKeyDown, so Enter is caught on a wrapper. */}
      <div
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      >
        <TextField
          label={label}
          value={draft}
          onChange={setDraft}
          onBlur={commit}
          autoComplete="off"
          placeholder="Type a tag and press Enter"
        />
      </div>
      {values.length > 0 ? (
        <InlineGrid columns={{ xs: 1 }}>
          <InlineStack gap="100" wrap>
            {values.map((tag) => (
              <Tag
                key={tag}
                onRemove={() => onChange(values.filter((v) => v !== tag))}
              >
                {tag}
              </Tag>
            ))}
          </InlineStack>
        </InlineGrid>
      ) : null}
    </BlockStack>
  );
}
