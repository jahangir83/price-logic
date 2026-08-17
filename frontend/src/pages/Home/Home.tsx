import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { BlockStack, Card, Layout, Page, Text, Button } from '@shopify/polaris';
import type { SetupGuideDto } from '@pricelogic/shared';
import { dismissSetupGuide, getSetupGuide } from '../../api/settings';
import { SetupGuide } from './SetupGuide';

/**
 * The app's home screen.
 *
 * Its job is to be somewhere a merchant can land that is not a list and not a
 * form. The setup guide sits at the top while there is anything left to
 * suggest, and disappears for good once dismissed.
 *
 * The guide's absence is never an error state. If the request fails the page
 * still renders — an onboarding checklist that cannot load is not a reason to
 * withhold the app from someone who has already installed it.
 */
export function Home(): ReactElement {
  const navigate = useNavigate();
  const [guide, setGuide] = useState<SetupGuideDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSetupGuide()
      .then((result) => {
        if (!cancelled) setGuide(result);
      })
      .catch(() => {
        /* The guide is a suggestion; the app works without it. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    // Hidden immediately rather than after the round trip. The merchant asked
    // for it to go away, and the server can confirm in its own time.
    setGuide(null);
    void dismissSetupGuide().catch(() => undefined);
  }, []);

  return (
    <Page title="PriceLogic">
      <Layout>
        {guide && !guide.dismissed && (
          <Layout.Section>
            <SetupGuide
              guide={guide}
              onNavigate={(to) => navigate(to)}
              onDismiss={dismiss}
            />
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Campaigns
              </Text>
              <Text as="p" tone="subdued">
                A campaign changes the price of a set of products for a period
                of time, and puts every price back when it ends.
              </Text>
              <BlockStack gap="200" inlineAlign="start">
                <Button variant="primary" onClick={() => navigate('/campaigns/new')}>
                  Create campaign
                </Button>
                <Button variant="plain" onClick={() => navigate('/campaigns')}>
                  View all campaigns
                </Button>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
