import {
  BlockStack,
  Button,
  Card,
  InlineStack,
  Select,
  Text,
} from '@shopify/polaris';
import type { StepProps } from '../types';

const OPTIONS = [
  { label: 'Percentage markup over cost', value: 'PERCENTAGE_MARKUP' },
  { label: 'Fixed markup over cost', value: 'FIXED_MARKUP' },
  { label: 'Target margin', value: 'TARGET_MARGIN' },
];

export function DefaultPricingStrategyStep({
  settings,
  updateSettings,
  onNext,
  onSkip,
  onBack,
}: StepProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          Default pricing strategy
        </Text>
        <Text as="p">
          Choose how new pricing rules will calculate a selling price by
          default. You can override this per rule later.
        </Text>
        <Select
          label="Pricing strategy"
          options={OPTIONS}
          value={settings.defaultPricingStrategy ?? ''}
          placeholder="Choose a strategy"
          onChange={(value) =>
            updateSettings({
              defaultPricingStrategy: value as
                'PERCENTAGE_MARKUP' | 'FIXED_MARKUP' | 'TARGET_MARGIN',
            })
          }
        />
        <InlineStack gap="200">
          {onBack && <Button onClick={onBack}>Back</Button>}
          <Button onClick={onSkip}>Skip</Button>
          <Button variant="primary" onClick={onNext}>
            Continue
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
