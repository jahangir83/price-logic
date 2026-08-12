import { useState } from 'react';
import {
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Text,
} from '@shopify/polaris';
import { completeStoreSetup } from '../../../api/store-init';

interface FinishStepProps {
  onBack?: () => void;
  onFinished: () => void;
}

export function FinishStep({ onBack, onFinished }: FinishStepProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFinish() {
    setIsSubmitting(true);
    setError(null);
    try {
      await completeStoreSetup();
      onFinished();
    } catch {
      setError('Could not finish setup — please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          You're all set
        </Text>
        <Text as="p">
          Setup is complete. Every default you chose can still be changed later
          from Settings.
        </Text>
        {error && <Banner tone="critical">{error}</Banner>}
        <InlineStack gap="200">
          {onBack && <Button onClick={onBack}>Back</Button>}
          <Button
            variant="primary"
            loading={isSubmitting}
            onClick={() => void handleFinish()}
          >
            Finish setup
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
