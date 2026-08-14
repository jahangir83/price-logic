import {
  BlockStack,
  Badge,
  Card,
  Checkbox,
  InlineStack,
  RadioButton,
  Tabs,
  Text,
} from '@shopify/polaris';
import { useState } from 'react';
import { CampaignIncludeMode } from '@pricelogic/shared';
import {
  CollectionPicker,
  FacetPicker,
  ProductPicker,
  type FacetSelection,
} from '../../components/pickers';
import {
  countExcludeTargets,
  countIncludeTargets,
  type CampaignFormState,
} from './campaignFormState';

interface TargetingSectionProps {
  form: CampaignFormState;
  onChange: (patch: Partial<CampaignFormState>) => void;
}

const PICKER_TABS = [
  { id: 'products', content: 'Products' },
  { id: 'collections', content: 'Collections' },
  { id: 'facets', content: 'Tags, vendors & types' },
];

/**
 * Include and exclude, built from the Phase 2 pickers.
 *
 * Both sides use the same three pickers, which is the point of them being
 * shared components — "all products except this vendor" and "only this vendor"
 * are the same selection UI pointed at different fields.
 */
export function TargetingSection({ form, onChange }: TargetingSectionProps) {
  const [includeTab, setIncludeTab] = useState(0);
  const [excludeTab, setExcludeTab] = useState(0);

  const includeCount = countIncludeTargets(form);
  const excludeCount = countExcludeTargets(form);

  const includeFacets: FacetSelection = {
    tags: form.includeTags,
    vendors: form.includeVendors,
    productTypes: form.includeProductTypes,
  };

  const excludeFacets: FacetSelection = {
    tags: form.excludeTags,
    vendors: form.excludeVendors,
    productTypes: form.excludeProductTypes,
  };

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              Which products
            </Text>
            {form.includeMode === CampaignIncludeMode.SPECIFIC ? (
              <Badge tone={includeCount > 0 ? 'success' : 'attention'}>
                {`${includeCount} selected`}
              </Badge>
            ) : null}
          </InlineStack>

          <RadioButton
            label="All products"
            helpText="Every product in the store, minus anything excluded below."
            checked={form.includeMode === CampaignIncludeMode.ALL_PRODUCTS}
            id="include-all"
            name="includeMode"
            onChange={() =>
              onChange({ includeMode: CampaignIncludeMode.ALL_PRODUCTS })
            }
          />
          <RadioButton
            label="Specific products"
            helpText="Only what you choose here."
            checked={form.includeMode === CampaignIncludeMode.SPECIFIC}
            id="include-specific"
            name="includeMode"
            onChange={() =>
              onChange({ includeMode: CampaignIncludeMode.SPECIFIC })
            }
          />

          {form.includeMode === CampaignIncludeMode.SPECIFIC ? (
            <BlockStack gap="300">
              <Tabs
                tabs={PICKER_TABS}
                selected={includeTab}
                onSelect={setIncludeTab}
              />
              {includeTab === 0 ? (
                <ProductPicker
                  selectedIds={form.includeProducts}
                  onChange={(ids) => onChange({ includeProducts: ids })}
                />
              ) : null}
              {includeTab === 1 ? (
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">
                    Collections are checked when the campaign runs, so products
                    you add to them before then are included automatically.
                  </Text>
                  <CollectionPicker
                    selectedIds={form.includeCollections}
                    onChange={(ids) => onChange({ includeCollections: ids })}
                  />
                </BlockStack>
              ) : null}
              {includeTab === 2 ? (
                <FacetPicker
                  selection={includeFacets}
                  onChange={(next) =>
                    onChange({
                      includeTags: next.tags,
                      includeVendors: next.vendors,
                      includeProductTypes: next.productTypes,
                    })
                  }
                />
              ) : null}
            </BlockStack>
          ) : null}
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              Exclusions
            </Text>
            {form.exclusionsEnabled ? (
              <Badge>{`${excludeCount} excluded`}</Badge>
            ) : null}
          </InlineStack>

          <Checkbox
            label="Skip draft and archived products"
            helpText="Applies whether or not the exclusion list below is on."
            checked={form.excludeDraftArchived}
            onChange={(value) => onChange({ excludeDraftArchived: value })}
          />

          <Checkbox
            label="Use my exclusion list"
            helpText="Turn this off to pause your exclusions without deleting them."
            checked={form.exclusionsEnabled}
            onChange={(value) => onChange({ exclusionsEnabled: value })}
          />

          {form.exclusionsEnabled ? (
            <BlockStack gap="300">
              <Text as="p" tone="subdued">
                Anything selected here is left alone, even if it also matches
                above.
              </Text>
              <Tabs
                tabs={PICKER_TABS}
                selected={excludeTab}
                onSelect={setExcludeTab}
              />
              {excludeTab === 0 ? (
                <ProductPicker
                  selectedIds={form.excludeProducts}
                  onChange={(ids) => onChange({ excludeProducts: ids })}
                />
              ) : null}
              {excludeTab === 1 ? (
                <CollectionPicker
                  selectedIds={form.excludeCollections}
                  onChange={(ids) => onChange({ excludeCollections: ids })}
                />
              ) : null}
              {excludeTab === 2 ? (
                <FacetPicker
                  selection={excludeFacets}
                  onChange={(next) =>
                    onChange({
                      excludeTags: next.tags,
                      excludeVendors: next.vendors,
                      excludeProductTypes: next.productTypes,
                    })
                  }
                />
              ) : null}
            </BlockStack>
          ) : null}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
