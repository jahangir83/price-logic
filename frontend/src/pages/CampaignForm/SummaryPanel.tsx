import { BlockStack, Card, Divider, InlineStack, Text } from '@shopify/polaris';
import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignBasis,
  CampaignIncludeMode,
  applyPriceEnding,
  calculatePrice,
  formatMoney,
  isMoney,
  type Money,
} from '@pricelogic/shared';
import {
  countExcludeTargets,
  countIncludeTargets,
  type CampaignFormState,
} from './campaignFormState';

interface SummaryPanelProps {
  form: CampaignFormState;
  currency: string;
}

/** A representative price, so the merchant sees the maths on a real number. */
const EXAMPLE_PRICE: Money = '24.9900';

/**
 * The live summary beside the form.
 *
 * The worked example runs `calculatePrice` — **the same function the server
 * runs at activation**. That is the whole reason it lives in the shared
 * package: a preview computed by a second implementation is a preview that
 * eventually lies, and this one is the merchant's basis for approving.
 */
export function SummaryPanel({ form, currency }: SummaryPanelProps) {
  const example = buildExample(form);

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Summary
        </Text>

        <BlockStack gap="150">
          <Row label="Applies to" value={scopeLabel(form)} />
          <Row label="Based on" value={basisLabel(form.basis)} />
          <Row label="Change" value={adjustmentLabel(form)} />
          <Row
            label="Rounding"
            value={
              form.roundingEnabled
                ? `${strategyLabel(form.roundStrategy)} to end in ${form.roundTo}`
                : 'Off'
            }
          />
          <Row
            label="Compare-at"
            value={
              form.setCompareAt
                ? 'Show the old price struck through'
                : 'Leave unchanged'
            }
          />
          <Row
            label="Ends"
            value={
              form.endAt
                ? new Date(form.endAt).toLocaleString()
                : 'Never — you deactivate it yourself'
            }
          />
        </BlockStack>

        {example ? (
          <>
            <Divider />
            <BlockStack gap="150">
              <Text as="h3" variant="headingSm">
                Example
              </Text>
              <Text as="p" tone="subdued">
                A product priced {formatMoney(EXAMPLE_PRICE, currency)} would
                become{' '}
                <Text as="span" fontWeight="semibold">
                  {formatMoney(example.newPrice, currency)}
                </Text>
                {example.newCompareAtPrice
                  ? `, shown next to ${formatMoney(example.newCompareAtPrice, currency)}`
                  : ''}
                .
              </Text>
              {example.outcome === 'FLOORED' ? (
                <Text as="p" tone="caution">
                  That discount takes the price below zero, so it would be
                  clamped.
                </Text>
              ) : null}
              {form.roundingEnabled && example.roundingLifted ? (
                <Text as="p" tone="caution">
                  Rounding {strategyLabel(form.roundStrategy).toLowerCase()}{' '}
                  raised the discounted price. Choose “nearest” to avoid that.
                </Text>
              ) : null}
            </BlockStack>
          </>
        ) : null}
      </BlockStack>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <InlineStack align="space-between" gap="200" wrap={false}>
      <Text as="span" tone="subdued">
        {label}
      </Text>
      <Text as="span" alignment="end">
        {value}
      </Text>
    </InlineStack>
  );
}

function buildExample(form: CampaignFormState) {
  if (form.adjustmentEnabled && !isMoney(form.adjustmentValue.trim())) {
    return null;
  }
  if (form.roundingEnabled && !isMoney(form.roundTo)) return null;

  try {
    const result = calculatePrice({
      currentPrice: EXAMPLE_PRICE,
      currentCompareAtPrice: null,
      basePrice: EXAMPLE_PRICE,
      adjustment: form.adjustmentEnabled
        ? {
            unit: form.adjustmentUnit,
            direction: form.adjustmentDirection,
            value: form.adjustmentValue.trim() as Money,
          }
        : null,
      roundTo: form.roundingEnabled ? (form.roundTo as Money) : null,
      roundStrategy: form.roundStrategy,
      setCompareAt: form.setCompareAt,
    });

    // Did rounding push the price back up above what the discount produced?
    const unrounded = calculatePrice({
      currentPrice: EXAMPLE_PRICE,
      basePrice: EXAMPLE_PRICE,
      adjustment: form.adjustmentEnabled
        ? {
            unit: form.adjustmentUnit,
            direction: form.adjustmentDirection,
            value: form.adjustmentValue.trim() as Money,
          }
        : null,
    });

    return {
      ...result,
      roundingLifted:
        form.roundingEnabled &&
        applyPriceEnding(
          unrounded.newPrice,
          form.roundTo as Money,
          form.roundStrategy,
        ) !== unrounded.newPrice &&
        Number(result.newPrice) > Number(unrounded.newPrice),
    };
  } catch {
    // A half-typed value is not an error worth showing; the example just waits.
    return null;
  }
}

function scopeLabel(form: CampaignFormState): string {
  const base =
    form.includeMode === CampaignIncludeMode.ALL_PRODUCTS
      ? 'All products'
      : `${countIncludeTargets(form)} selection${countIncludeTargets(form) === 1 ? '' : 's'}`;

  const excluded = form.exclusionsEnabled ? countExcludeTargets(form) : 0;
  return excluded > 0 ? `${base}, minus ${excluded}` : base;
}

function basisLabel(basis: CampaignBasis): string {
  return basis === CampaignBasis.COMPARE_AT_PRICE
    ? 'Compare-at price'
    : 'Current price';
}

function adjustmentLabel(form: CampaignFormState): string {
  if (!form.adjustmentEnabled) return 'Use the price as-is';
  const value = form.adjustmentValue.trim() || '0';
  const unit = form.adjustmentUnit === CampaignAdjustmentUnit.PERCENTAGE ? '%' : '';
  const direction =
    form.adjustmentDirection === CampaignAdjustmentDirection.INCREASE
      ? 'Increase'
      : 'Decrease';
  return `${direction} by ${value}${unit}`;
}

function strategyLabel(strategy: 'UP' | 'DOWN' | 'NEAREST'): string {
  if (strategy === 'NEAREST') return 'Nearest';
  return strategy === 'UP' ? 'Up' : 'Down';
}
