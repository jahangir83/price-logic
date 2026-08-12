import { Banner, Card, Page, Text } from '@shopify/polaris';
import { useSearchParams } from 'react-router-dom';

const MESSAGES: Record<string, string> = {
  invalid_shop: 'That doesn’t look like a valid Shopify store address.',
  missing_params:
    'The connection to Shopify was incomplete. Please try installing again.',
  state_mismatch:
    'This authorization request expired or was tampered with. Please try again.',
  invalid_hmac:
    'We couldn’t verify this request came from Shopify. Please try again.',
  token_exchange_failed:
    'We couldn’t finish connecting to your Shopify store. Please try again.',
  unknown_error: 'Something went wrong while connecting your store.',
};

export function AuthError() {
  const [searchParams] = useSearchParams();
  const reason = searchParams.get('reason') ?? 'unknown_error';
  const message = MESSAGES[reason] ?? MESSAGES.unknown_error;

  return (
    <Page title="Couldn't connect your store">
      <Card>
        <Banner tone="critical">
          <Text as="p">{message}</Text>
        </Banner>
      </Card>
    </Page>
  );
}
