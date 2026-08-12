import { useEffect, useState } from 'react';
import {
  BlockStack,
  Button,
  Card,
  InlineStack,
  Spinner,
  Text,
} from '@shopify/polaris';
import {
  getStoreInitStatus,
  type InitializationStatus,
} from '../../../api/store-init';
import type { StepProps } from '../types';

export function ProductSyncStep({ onNext, onSkip, onBack }: StepProps) {
  const [status, setStatus] = useState<InitializationStatus | null>(null);

  useEffect(() => {
    getStoreInitStatus()
      .then((result) => setStatus(result.initializationStatus))
      .catch(() => setStatus(null));
  }, []);

  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          Syncing your products
        </Text>
        <InlineStack gap="200" blockAlign="center">
          {status === 'IN_PROGRESS' && <Spinner size="small" />}
          <Text as="p">
            {status === 'COMPLETE'
              ? 'Product sync is complete.'
              : 'Product sync is running in the background — this can continue after you finish setup.'}
          </Text>
        </InlineStack>
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
