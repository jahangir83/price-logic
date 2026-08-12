import { useCallback, useEffect, useState } from 'react';
import { BlockStack, Page, ProgressBar, Text } from '@shopify/polaris';
import {
  getStoreInitStatus,
  updateDefaultSettings,
  type DefaultSettings,
} from '../../api/store-init';
import { DefaultPricingStrategyStep } from './steps/DefaultPricingStrategyStep';
import { FinishStep } from './steps/FinishStep';
import { MinimumProtectionsStep } from './steps/MinimumProtectionsStep';
import { ProductSyncStep } from './steps/ProductSyncStep';
import { StoreConnectedStep } from './steps/StoreConnectedStep';
import { WIZARD_STEPS, type WizardStep } from './types';

const STEP_LABELS: Record<WizardStep, string> = {
  connected: 'Store connected',
  sync: 'Product sync',
  pricing: 'Pricing strategy',
  protections: 'Price protection',
  finish: 'Finish',
};

export function SetupWizard() {
  const [stepIndex, setStepIndex] = useState(0);
  const [settings, setSettings] = useState<DefaultSettings>({});
  const [isFinished, setIsFinished] = useState(false);

  useEffect(() => {
    getStoreInitStatus()
      .then((result) => setSettings(result.defaultSettings))
      .catch(() => {
        /* Wizard still works with empty defaults if the fetch fails. */
      });
  }, []);

  const updateSettings = useCallback((patch: Partial<DefaultSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const goNext = useCallback(async () => {
    // Persist whatever has been entered so far before advancing — every
    // value here remains editable later, so a partial save is fine.
    await updateDefaultSettings(settings).catch(() => undefined);
    setStepIndex((index) => Math.min(index + 1, WIZARD_STEPS.length - 1));
  }, [settings]);

  const goBack = useCallback(() => {
    setStepIndex((index) => Math.max(index - 1, 0));
  }, []);

  if (isFinished) {
    return (
      <Page title="Setup complete">
        <Text as="p">
          You're ready to start creating pricing rules and campaigns.
        </Text>
      </Page>
    );
  }

  const currentStep = WIZARD_STEPS[stepIndex];
  const progress = Math.round(((stepIndex + 1) / WIZARD_STEPS.length) * 100);

  return (
    <Page title="Set up PriceLogic">
      <BlockStack gap="400">
        <BlockStack gap="200">
          <ProgressBar progress={progress} size="small" />
          <Text as="span" tone="subdued">
            Step {stepIndex + 1} of {WIZARD_STEPS.length}:{' '}
            {STEP_LABELS[currentStep]}
          </Text>
        </BlockStack>

        {currentStep === 'connected' && (
          <StoreConnectedStep
            settings={settings}
            updateSettings={updateSettings}
            onNext={() => void goNext()}
            onSkip={() => void goNext()}
          />
        )}
        {currentStep === 'sync' && (
          <ProductSyncStep
            settings={settings}
            updateSettings={updateSettings}
            onNext={() => void goNext()}
            onSkip={() => void goNext()}
            onBack={goBack}
          />
        )}
        {currentStep === 'pricing' && (
          <DefaultPricingStrategyStep
            settings={settings}
            updateSettings={updateSettings}
            onNext={() => void goNext()}
            onSkip={() => void goNext()}
            onBack={goBack}
          />
        )}
        {currentStep === 'protections' && (
          <MinimumProtectionsStep
            settings={settings}
            updateSettings={updateSettings}
            onNext={() => void goNext()}
            onSkip={() => void goNext()}
            onBack={goBack}
          />
        )}
        {currentStep === 'finish' && (
          <FinishStep onBack={goBack} onFinished={() => setIsFinished(true)} />
        )}
      </BlockStack>
    </Page>
  );
}
