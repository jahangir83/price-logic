import { CampaignStatus } from '@pricelogic/shared';

/**
 * The campaign lifecycle, in one place.
 *
 * Phases 6 and 7 call `assertTransition` rather than assigning `status`
 * directly. That is the whole point of this file: a status set by hand in an
 * activation path is how a campaign ends up ACTIVE without ever having been
 * scheduled, or COMPLETED while a revert job is still running.
 */
const TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  // Activating straight from DRAFT is "start now" — a schedule is optional.
  [CampaignStatus.DRAFT]: [
    CampaignStatus.SCHEDULED,
    CampaignStatus.ACTIVE,
    CampaignStatus.CANCELLED,
  ],
  // Back to DRAFT is "unschedule", which merchants do more often than expected.
  [CampaignStatus.SCHEDULED]: [
    CampaignStatus.DRAFT,
    CampaignStatus.ACTIVE,
    CampaignStatus.CANCELLED,
    CampaignStatus.FAILED,
  ],
  [CampaignStatus.ACTIVE]: [
    CampaignStatus.COMPLETED,
    CampaignStatus.FAILED,
    CampaignStatus.CANCELLED,
  ],
  /*
   * FAILED is recoverable, not terminal. A campaign that failed at 40% is the
   * case a merchant most wants to retry, and `price_changes` is keyed on the
   * job rather than the campaign precisely so a second run does not collide
   * with the first. Back to DRAFT to fix the configuration, or straight to
   * ACTIVE to retry it unchanged.
   */
  [CampaignStatus.FAILED]: [
    CampaignStatus.DRAFT,
    CampaignStatus.ACTIVE,
    CampaignStatus.CANCELLED,
  ],
  [CampaignStatus.COMPLETED]: [],
  [CampaignStatus.CANCELLED]: [],
};

/** Statuses a campaign never leaves. */
export const TERMINAL_CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  CampaignStatus.COMPLETED,
  CampaignStatus.CANCELLED,
];

/**
 * Statuses in which the merchant may change the configuration.
 *
 * Deliberately excludes FAILED: a failed campaign may hold applied price
 * changes, and editing the configuration under them would leave the record of
 * what to revert describing something that never ran. Move it to DRAFT first —
 * that transition is where any cleanup belongs.
 */
export const EDITABLE_CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  CampaignStatus.DRAFT,
  CampaignStatus.SCHEDULED,
];

export function isTerminalCampaignStatus(status: CampaignStatus): boolean {
  return TERMINAL_CAMPAIGN_STATUSES.includes(status);
}

export function isEditableCampaignStatus(status: CampaignStatus): boolean {
  return EDITABLE_CAMPAIGN_STATUSES.includes(status);
}

export function canTransition(
  from: CampaignStatus,
  to: CampaignStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Every status reachable from here, for rendering available actions. */
export function allowedTransitions(
  from: CampaignStatus,
): readonly CampaignStatus[] {
  return TRANSITIONS[from];
}

export class CampaignTransitionError extends Error {
  constructor(
    readonly from: CampaignStatus,
    readonly to: CampaignStatus,
  ) {
    super(`A campaign cannot go from ${from} to ${to}.`);
    this.name = 'CampaignTransitionError';
  }
}

export function assertTransition(
  from: CampaignStatus,
  to: CampaignStatus,
): void {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new CampaignTransitionError(from, to);
  }
}
