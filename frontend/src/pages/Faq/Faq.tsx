import { useEffect, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BlockStack,
  Button,
  Card,
  InlineStack,
  Layout,
  Page,
  Text,
} from '@shopify/polaris';
import { SetupStep } from '@pricelogic/shared';
import { markStepSeen } from '../../api/settings';

/**
 * How the app behaves, in the app.
 *
 * Kept in-product rather than linked out for two reasons: a merchant reading it
 * inside the Shopify admin has not left what they were doing, and the setup
 * guide's step can complete on arrival — which it could not if the answer to
 * "have they read this" lived on someone else's domain.
 *
 * The answers describe what the code actually does. Every claim here is one the
 * implementation can be checked against, which is the only kind worth writing:
 * documentation that flatters the product is how support tickets are made.
 */
const ENTRIES: { question: string; answer: string[] }[] = [
  {
    question: 'What does a campaign actually change?',
    answer: [
      'The price of every product variant it targets, in your Shopify store, for as long as the campaign is active.',
      'The original price is recorded for each variant before it is changed. That record — not the campaign settings — is what the prices are restored from when the campaign ends.',
    ],
  },
  {
    question: 'Can I see what will happen before it happens?',
    answer: [
      'Yes, and you should. Every campaign has a preview listing each variant, its current price, and the price it would become.',
      'The preview is calculated by the server using the same code that performs the change, so what you approve is what runs.',
    ],
  },
  {
    question: 'What happens when a campaign ends?',
    answer: [
      'Each variant goes back to the price recorded when the campaign started it.',
      'If a second campaign is also holding a variant, the price is recalculated from the campaigns still running rather than being reset — so ending one sale does not cancel another.',
    ],
  },
  {
    question: 'Can I undo a campaign that has already run?',
    answer: [
      'Yes. Reverting replays the record of what was applied, variant by variant.',
      'It is deliberately driven by that record rather than by the campaign settings: if a price was changed by hand after the campaign ran, replaying the settings would overwrite work the app never did.',
    ],
  },
  {
    question: 'Do I have to finish setup before using PriceLogic?',
    answer: [
      'No. Your store is given sensible defaults the moment the app is installed, and every one of them can be changed later.',
      'The setup guide on the home screen is a suggestion. Dismissing it does not disable anything.',
    ],
  },
  {
    question: 'What does the minimum price setting do?',
    answer: [
      'It is a floor. No campaign will price a variant below it.',
      'A variant that would fall below is left at its current price rather than being sold at the floor — a clamped price is one you never chose, and you would have no way to tell it apart from one you did. The preview shows every variant this affects before you activate.',
      'The minimum margin is stored but not yet enforced.',
    ],
  },
  {
    question: 'What counts towards my plan limit?',
    answer: [
      'The number of distinct product variants held by campaigns that are active right now — not how many campaigns you have run.',
      'Running and reverting a 40-variant campaign ten times uses 40 of your quota, not 400. A variant claimed by two campaigns counts once.',
    ],
  },
];

export function Faq(): ReactElement {
  const navigate = useNavigate();

  useEffect(() => {
    void markStepSeen(SetupStep.FAQ).catch(() => undefined);
  }, []);

  return (
    <Page
      title="How PriceLogic works"
      backAction={{ content: 'Home', onAction: () => navigate('/') }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {ENTRIES.map((entry) => (
              <Card key={entry.question}>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    {entry.question}
                  </Text>
                  {entry.answer.map((paragraph) => (
                    <Text as="p" key={paragraph} tone="subdued">
                      {paragraph}
                    </Text>
                  ))}
                </BlockStack>
              </Card>
            ))}

            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Ready to try one?
                </Text>
                <Text as="p" tone="subdued">
                  Nothing is applied to your store until you activate a
                  campaign, and you see every price first.
                </Text>
                <InlineStack>
                  <Button
                    variant="primary"
                    onClick={() => navigate('/campaigns/new')}
                  >
                    Create a campaign
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
