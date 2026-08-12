import {
  BlockStack,
  Button,
  Card,
  InlineStack,
  Text,
  TextField,
} from '@shopify/polaris';
import type { StepProps } from '../types';

function toNumberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function MinimumProtectionsStep({
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
          Minimum margin &amp; price protection
        </Text>
        <Text as="p">
          These guardrails stop any pricing operation from producing a price
          below what you're comfortable with. Leave blank to skip for now — you
          can set these anytime.
        </Text>
        <TextField
          label="Minimum margin (%)"
          type="number"
          autoComplete="off"
          value={settings.minimumMarginPercent?.toString() ?? ''}
          onChange={(value) =>
            updateSettings({ minimumMarginPercent: toNumberOrUndefined(value) })
          }
        />
        <TextField
          label="Minimum price"
          type="number"
          autoComplete="off"
          value={settings.minimumPrice?.toString() ?? ''}
          onChange={(value) =>
            updateSettings({ minimumPrice: toNumberOrUndefined(value) })
          }
        />
        <TextField
          label="Maximum price"
          type="number"
          autoComplete="off"
          value={settings.maximumPrice?.toString() ?? ''}
          onChange={(value) =>
            updateSettings({ maximumPrice: toNumberOrUndefined(value) })
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
