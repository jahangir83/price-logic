import { BlockStack, Button, Card, Text } from '@shopify/polaris';
import type { StepProps } from '../types';

export function StoreConnectedStep({ onNext }: StepProps) {
  return (
    <Card>
      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          Your store is connected
        </Text>
        <Text as="p">
          PriceLogic successfully authenticated with your Shopify store. Next,
          we'll sync your products and set a few defaults — all of which you can
          change later.
        </Text>
        <Button variant="primary" onClick={onNext}>
          Continue
        </Button>
      </BlockStack>
    </Card>
  );
}
