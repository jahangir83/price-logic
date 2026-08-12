import type { DefaultSettings } from '../../api/store-init';

export type WizardStep =
  'connected' | 'sync' | 'pricing' | 'protections' | 'finish';

export const WIZARD_STEPS: WizardStep[] = [
  'connected',
  'sync',
  'pricing',
  'protections',
  'finish',
];

export interface StepProps {
  settings: DefaultSettings;
  updateSettings: (patch: Partial<DefaultSettings>) => void;
  onNext: () => void;
  onSkip: () => void;
  onBack?: () => void;
}
