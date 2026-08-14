import { useEffect, useState } from 'react';
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Grid,
  InlineStack,
  Page,
  ProgressBar,
  SkeletonBodyText,
  Text,
} from '@shopify/polaris';
import {
  AppPlanHandle,
  type AppPlanDto,
  type ResolvedPlanLimits,
  type StoreSubscriptionDto,
  type StoreUsageDto,
} from '@pricelogic/shared';
import { ApiError, apiFetch } from '../../api/client';

interface BillingOverview {
  plans: AppPlanDto[];
  subscription: StoreSubscriptionDto | null;
  currentPlanHandle: AppPlanHandle;
  limits: ResolvedPlanLimits;
  usage: StoreUsageDto;
}

/**
 * Plans, and how much of the current one the shop is using.
 *
 * The usage meter is the point. "20,000 variants" means nothing on its own;
 * "you are using 1,450 of 20,000" is what tells a merchant whether to upgrade,
 * and it is the same number the server enforces.
 */
export function Pricing() {
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState<AppPlanHandle | null>(null);

  useEffect(() => {
    let cancelled = false;

    apiFetch<BillingOverview>('/billing/overview')
      .then((result) => {
        if (cancelled) return;
        setOverview(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError ? cause.message : 'Could not load plans.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const choose = (plan: AppPlanHandle) => {
    setChanging(plan);
    apiFetch<{ confirmationUrl: string | null }>('/billing/subscribe', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    })
      .then((result) => {
        // Shopify hosts the confirmation screen; nothing is charged until the
        // merchant accepts it there.
        if (result.confirmationUrl) {
          window.top!.location.href = result.confirmationUrl;
          return;
        }
        window.location.reload();
      })
      .catch((cause: unknown) => {
        setError(
          cause instanceof ApiError ? cause.message : 'Could not change plan.',
        );
        setChanging(null);
      });
  };

  if (loading || !overview) {
    return (
      <Card>
        <SkeletonBodyText lines={8} />
      </Card>
    );
  }

  return (
    <Page title="Plans">
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Something went wrong">
            <Text as="p">{error}</Text>
          </Banner>
        ) : null}

        {overview.subscription?.isInGracePeriod ? (
          <Banner tone="warning" title="We could not take your last payment">
            <Text as="p">
              Your plan is still active while Shopify retries your card. Update
              your payment method in Shopify to avoid losing it.
            </Text>
          </Banner>
        ) : null}

        <UsageCard overview={overview} />

        <Grid>
          {overview.plans.map((plan) => (
            <Grid.Cell
              key={plan.id}
              columnSpan={{ xs: 6, sm: 6, md: 3, lg: 3, xl: 3 }}
            >
              <PlanCard
                plan={plan}
                current={plan.handle === overview.currentPlanHandle}
                busy={changing === plan.handle}
                onChoose={() => choose(plan.handle)}
              />
            </Grid.Cell>
          ))}
        </Grid>
      </BlockStack>
    </Page>
  );
}

function UsageCard({ overview }: { overview: BillingOverview }) {
  const limit = overview.limits.activeVariantLimit;
  const used = overview.usage.activeVariantCount;
  // A null limit is unlimited, and a progress bar for unlimited is nonsense.
  const percent = limit === null ? 0 : Math.min(100, (used / limit) * 100);

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Variants on sale
          </Text>
          <Text as="span" fontWeight="semibold">
            {limit === null ? `${used} — no limit` : `${used} of ${limit}`}
          </Text>
        </InlineStack>

        {limit !== null ? (
          <ProgressBar
            progress={percent}
            tone={percent >= 90 ? 'critical' : 'primary'}
            size="small"
          />
        ) : null}

        <Text as="p" tone="subdued">
          This counts products discounted by campaigns running right now. Ending
          a campaign frees its variants again.
        </Text>
      </BlockStack>
    </Card>
  );
}

function PlanCard({
  plan,
  current,
  busy,
  onChoose,
}: {
  plan: AppPlanDto;
  current: boolean;
  busy: boolean;
  onChoose: () => void;
}) {
  const price =
    plan.priceCents === 0 ? 'Free' : `$${(plan.priceCents / 100).toFixed(2)}`;

  return (
    <Card>
      <BlockStack gap="300">
        <BlockStack gap="100">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h3" variant="headingMd">
              {plan.name}
            </Text>
            {current ? <Badge tone="success">Current</Badge> : null}
          </InlineStack>
          <Text as="p" variant="heading2xl">
            {price}
          </Text>
          {plan.priceCents > 0 ? (
            <Text as="p" tone="subdued">
              per month
            </Text>
          ) : null}
        </BlockStack>

        <BlockStack gap="100">
          <Text as="p">
            {plan.activeVariantLimit === null
              ? 'Unlimited variants on sale'
              : `Up to ${plan.activeVariantLimit.toLocaleString()} variants on sale`}
          </Text>
          <Text as="p">
            {plan.activeCampaignLimit === null
              ? 'Unlimited campaigns at once'
              : `${plan.activeCampaignLimit} campaign${plan.activeCampaignLimit === 1 ? '' : 's'} at once`}
          </Text>
          {plan.trialDays > 0 ? (
            <Text as="p" tone="subdued">
              {`${plan.trialDays}-day free trial`}
            </Text>
          ) : null}
        </BlockStack>

        <Button
          variant={current ? 'secondary' : 'primary'}
          disabled={current || busy}
          loading={busy}
          onClick={onChoose}
          fullWidth
        >
          {current ? 'Your plan' : `Switch to ${plan.name}`}
        </Button>
      </BlockStack>
    </Card>
  );
}
