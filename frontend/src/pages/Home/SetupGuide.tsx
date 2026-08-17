import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  Collapsible,
  InlineStack,
  BlockStack,
  Text,
} from '@shopify/polaris';
import { SetupStep, type SetupGuideDto } from '@pricelogic/shared';
import { ProgressRing, StepMarker } from './ProgressRing';

/**
 * The setup guide.
 *
 * Three suggestions, none of them required. Nothing here gates anything else in
 * the app — a merchant can ignore every step and still build a campaign, which
 * is the whole reason the setup wizard it replaced was removed.
 *
 * Two steps complete by being visited and one by having a campaign, so a
 * merchant who wandered into settings before ever seeing this card finds it
 * already ticked. That is deliberate: the guide describes what has happened,
 * it does not ask for it to happen again in the right order.
 */
interface StepCopy {
  title: string;
  description: string;
  action: { label: string; to: string };
}

const COPY: Record<SetupStep, StepCopy> = {
  [SetupStep.SETTINGS]: {
    title: 'Review your pricing defaults',
    description:
      'Your store already has sensible defaults. Change the minimum price and margin if your products need different guardrails.',
    action: { label: 'Open settings', to: '/settings' },
  },
  [SetupStep.FAQ]: {
    title: 'Learn how campaigns work',
    description:
      'How prices are changed, what happens when a campaign ends, and how to undo one.',
    action: { label: 'Read the FAQ', to: '/faq' },
  },
  [SetupStep.FIRST_CAMPAIGN]: {
    title: 'Create your first campaign',
    description:
      'Pick the products, choose the discount, and see every new price before anything is applied.',
    action: { label: 'Create campaign', to: '/campaigns/new' },
  },
};

export function SetupGuide({
  guide,
  onNavigate,
  onDismiss,
}: {
  guide: SetupGuideDto;
  onNavigate: (to: string) => void;
  onDismiss: () => void;
}): ReactElement {
  const allDone = guide.completedCount === guide.totalCount;
  // Collapsed once everything is done: a finished checklist is a reminder of
  // nothing, and it should not sit above the app's actual content forever.
  const [open, setOpen] = useState(!allDone);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            <ProgressRing
              completed={guide.completedCount}
              total={guide.totalCount}
            />
            <BlockStack gap="050">
              <Text as="h2" variant="headingMd">
                Setup guide
              </Text>
              <Text as="span" tone="subdued" variant="bodySm">
                {allDone
                  ? 'All steps completed'
                  : `${guide.completedCount} of ${guide.totalCount} steps completed`}
              </Text>
            </BlockStack>
          </InlineStack>

          <InlineStack gap="200" blockAlign="center" wrap={false}>
            <Button variant="tertiary" onClick={onDismiss}>
              Dismiss
            </Button>
            <Button
              variant="tertiary"
              onClick={() => setOpen((current) => !current)}
              ariaExpanded={open}
              ariaControls="setup-guide-steps"
            >
              {open ? 'Hide' : 'Show'}
            </Button>
          </InlineStack>
        </InlineStack>

        <Collapsible open={open} id="setup-guide-steps">
          <BlockStack gap="500">
            {guide.steps.map((step) => (
              <Step
                key={step.step}
                copy={COPY[step.step]}
                done={step.completed}
                onAction={onNavigate}
              />
            ))}
          </BlockStack>
        </Collapsible>
      </BlockStack>
    </Card>
  );
}

function Step({
  copy,
  done,
  onAction,
}: {
  copy: StepCopy;
  done: boolean;
  onAction: (to: string) => void;
}): ReactElement {
  return (
    <InlineStack gap="300" wrap={false} blockAlign="start">
      <div style={{ paddingTop: '0.15rem' }}>
        <StepMarker done={done} />
      </div>
      <BlockStack gap="200">
        <Text
          as="h3"
          variant="headingSm"
          tone={done ? 'subdued' : undefined}
          textDecorationLine={done ? 'line-through' : undefined}
        >
          {copy.title}
        </Text>
        <Text as="p" tone="subdued">
          {copy.description}
        </Text>
        {/*
          The action stays after a step is done. These are places in the app,
          not one-time chores — a merchant who has been to settings once still
          wants the shortcut back.
        */}
        <InlineStack>
          <Button onClick={() => onAction(copy.action.to)}>
            {copy.action.label}
          </Button>
        </InlineStack>
      </BlockStack>
    </InlineStack>
  );
}
