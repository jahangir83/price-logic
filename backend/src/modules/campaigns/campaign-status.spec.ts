import { CampaignStatus } from '@pricelogic/shared';
import {
  CampaignTransitionError,
  allowedTransitions,
  assertTransition,
  canTransition,
  isEditableCampaignStatus,
  isTerminalCampaignStatus,
} from './campaign-status';

const { DRAFT, SCHEDULED, ACTIVE, COMPLETED, FAILED, CANCELLED } =
  CampaignStatus;

describe('campaign status transitions', () => {
  it.each([
    [DRAFT, SCHEDULED],
    [DRAFT, ACTIVE], // "start now" — a schedule is optional
    [DRAFT, CANCELLED],
    [SCHEDULED, ACTIVE],
    [SCHEDULED, DRAFT], // unschedule
    [SCHEDULED, CANCELLED],
    [SCHEDULED, FAILED],
    [ACTIVE, COMPLETED],
    [ACTIVE, FAILED],
    [ACTIVE, CANCELLED],
    [FAILED, DRAFT], // fix the configuration
    [FAILED, ACTIVE], // retry unchanged
    [FAILED, CANCELLED],
  ])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each([
    [DRAFT, COMPLETED], // nothing ran, so nothing completed
    [DRAFT, FAILED],
    [SCHEDULED, COMPLETED],
    [ACTIVE, DRAFT], // prices are live; editing under them loses the record
    [ACTIVE, SCHEDULED],
    [COMPLETED, ACTIVE],
    [COMPLETED, DRAFT],
    [CANCELLED, ACTIVE],
    [CANCELLED, DRAFT],
  ])('refuses %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(CampaignTransitionError);
  });

  it('treats a no-op transition as allowed', () => {
    // Re-saving a campaign in the same status must not fail.
    for (const status of Object.values(CampaignStatus)) {
      expect(() => assertTransition(status, status)).not.toThrow();
    }
  });

  it('names both states in the error', () => {
    expect(() => assertTransition(COMPLETED, ACTIVE)).toThrow(
      /COMPLETED to ACTIVE/,
    );
  });

  it('leaves terminal statuses with nowhere to go', () => {
    expect(allowedTransitions(COMPLETED)).toEqual([]);
    expect(allowedTransitions(CANCELLED)).toEqual([]);
  });

  it('reaches CANCELLED from every non-terminal status', () => {
    for (const status of [DRAFT, SCHEDULED, ACTIVE, FAILED]) {
      expect(canTransition(status, CANCELLED)).toBe(true);
    }
  });

  it('never lets a terminal status move', () => {
    for (const from of [COMPLETED, CANCELLED]) {
      for (const to of Object.values(CampaignStatus)) {
        if (from === to) continue;
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });
});

describe('status predicates', () => {
  it('marks only COMPLETED and CANCELLED terminal', () => {
    expect(isTerminalCampaignStatus(COMPLETED)).toBe(true);
    expect(isTerminalCampaignStatus(CANCELLED)).toBe(true);
    // FAILED is recoverable — a campaign that failed at 40% is exactly the one
    // a merchant wants to retry.
    expect(isTerminalCampaignStatus(FAILED)).toBe(false);
    expect(isTerminalCampaignStatus(ACTIVE)).toBe(false);
  });

  it('allows editing only in DRAFT and SCHEDULED', () => {
    expect(isEditableCampaignStatus(DRAFT)).toBe(true);
    expect(isEditableCampaignStatus(SCHEDULED)).toBe(true);
    expect(isEditableCampaignStatus(ACTIVE)).toBe(false);
    expect(isEditableCampaignStatus(COMPLETED)).toBe(false);
    // A failed campaign may hold applied changes; move it to DRAFT first.
    expect(isEditableCampaignStatus(FAILED)).toBe(false);
  });
});
