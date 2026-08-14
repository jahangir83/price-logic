import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignPriceSource,
} from '@pricelogic/shared';
import {
  isValidTimezone,
  validateAdjustment,
  validateCampaign,
  validatePriceSource,
  validateSchedule,
} from './campaign-rules';

const PERCENT = CampaignAdjustmentUnit.PERCENTAGE;
const FIXED = CampaignAdjustmentUnit.FIXED_AMOUNT;
const UP = CampaignAdjustmentDirection.INCREASE;
const DOWN = CampaignAdjustmentDirection.DECREASE;

describe('validateAdjustment', () => {
  it('accepts no adjustment at all — a plain supplier sheet', () => {
    expect(validateAdjustment({})).toBeNull();
    expect(
      validateAdjustment({
        adjustmentUnit: null,
        adjustmentDirection: null,
        adjustmentValue: null,
      }),
    ).toBeNull();
  });

  it('accepts a fully specified adjustment', () => {
    expect(
      validateAdjustment({
        adjustmentUnit: PERCENT,
        adjustmentDirection: DOWN,
        adjustmentValue: '20',
      }),
    ).toBeNull();
  });

  it.each([
    ['unit only', { adjustmentUnit: PERCENT }],
    ['direction only', { adjustmentDirection: DOWN }],
    ['value only', { adjustmentValue: '20' }],
    ['two of three', { adjustmentUnit: PERCENT, adjustmentDirection: DOWN }],
  ])('rejects a half-specified adjustment (%s)', (_label, input) => {
    expect(validateAdjustment(input)).toMatch(/unit, a direction and a value/);
  });

  it('rejects a zero value rather than treating it as no adjustment', () => {
    // A merchant who typed 0 meant something; doing nothing hides the mistake.
    expect(
      validateAdjustment({
        adjustmentUnit: PERCENT,
        adjustmentDirection: DOWN,
        adjustmentValue: '0',
      }),
    ).toMatch(/greater than zero/);
  });

  it('rejects a negative value', () => {
    expect(
      validateAdjustment({
        adjustmentUnit: FIXED,
        adjustmentDirection: DOWN,
        adjustmentValue: '-5',
      }),
    ).toMatch(/greater than zero/);
  });

  it('rejects a value that is not exact decimal money', () => {
    expect(
      validateAdjustment({
        adjustmentUnit: FIXED,
        adjustmentDirection: UP,
        adjustmentValue: '5.000001',
      }),
    ).toMatch(/four decimal places/);
  });

  it('rejects a percentage decrease over 100%', () => {
    // 101% off is a negative price, which Shopify rejects mid-batch.
    expect(
      validateAdjustment({
        adjustmentUnit: PERCENT,
        adjustmentDirection: DOWN,
        adjustmentValue: '101',
      }),
    ).toMatch(/more than 100%/);
  });

  it('allows exactly 100% off — free is a legitimate price', () => {
    expect(
      validateAdjustment({
        adjustmentUnit: PERCENT,
        adjustmentDirection: DOWN,
        adjustmentValue: '100',
      }),
    ).toBeNull();
  });

  it('allows a fixed amount larger than any price — the floor handles it', () => {
    expect(
      validateAdjustment({
        adjustmentUnit: FIXED,
        adjustmentDirection: DOWN,
        adjustmentValue: '99999',
      }),
    ).toBeNull();
  });

  it('rejects an absurd percentage increase as a typo', () => {
    expect(
      validateAdjustment({
        adjustmentUnit: PERCENT,
        adjustmentDirection: UP,
        adjustmentValue: '100000',
      }),
    ).toMatch(/10,000%/);
  });
});

describe('isValidTimezone', () => {
  it.each(['UTC', 'America/New_York', 'Asia/Dhaka', 'Europe/London'])(
    'accepts %s',
    (zone) => {
      expect(isValidTimezone(zone)).toBe(true);
    },
  );

  it.each(['Mars/Olympus', 'GMT+5', '', 'utc/utc'])('rejects %s', (zone) => {
    expect(isValidTimezone(zone)).toBe(false);
  });
});

describe('validateSchedule', () => {
  const now = new Date('2026-08-14T12:00:00.000Z');
  const future = '2026-09-01T00:00:00.000Z';
  const later = '2026-09-08T00:00:00.000Z';

  it('accepts no schedule at all — activate manually', () => {
    expect(validateSchedule({}, { now })).toBeNull();
  });

  it('accepts a start with no end', () => {
    // A permanent repricing has no end date by definition. Requiring one would
    // make the merchant invent a date and be surprised when prices revert.
    expect(validateSchedule({ startAt: future }, { now })).toBeNull();
  });

  it('accepts a valid window', () => {
    expect(
      validateSchedule({ startAt: future, endAt: later }, { now }),
    ).toBeNull();
  });

  it('rejects an end before the start', () => {
    expect(
      validateSchedule({ startAt: later, endAt: future }, { now }),
    ).toMatch(/after the start/);
  });

  it('rejects an end equal to the start', () => {
    expect(
      validateSchedule({ startAt: future, endAt: future }, { now }),
    ).toMatch(/after the start/);
  });

  it('rejects a start in the past on create', () => {
    expect(
      validateSchedule(
        { startAt: '2026-08-01T00:00:00.000Z' },
        { now, isCreate: true },
      ),
    ).toMatch(/in the past/);
  });

  it('allows a past start when editing an existing campaign', () => {
    // Its start date is history; editing an unrelated field must not fail.
    expect(
      validateSchedule(
        { startAt: '2026-08-01T00:00:00.000Z' },
        { now, isCreate: false },
      ),
    ).toBeNull();
  });

  it('tolerates a start a few seconds in the past on create', () => {
    // The merchant picked "now" and the form took a moment to submit.
    expect(
      validateSchedule(
        { startAt: '2026-08-14T11:59:50.000Z' },
        { now, isCreate: true },
      ),
    ).toBeNull();
  });

  it.each(['startTimezone', 'endTimezone'])('rejects a bad %s', (field) => {
    expect(validateSchedule({ [field]: 'Mars/Olympus' }, { now })).toMatch(
      /not a recognised time zone/,
    );
  });

  it('rejects an unparseable date', () => {
    expect(validateSchedule({ startAt: 'next tuesday' }, { now })).toMatch(
      /not a valid date/,
    );
  });
});

describe('validatePriceSource', () => {
  it('accepts a plain campaign with no import', () => {
    expect(
      validatePriceSource({ priceSource: CampaignPriceSource.SHOPIFY_CURRENT }),
    ).toBeNull();
  });

  it('defaults to SHOPIFY_CURRENT when unspecified', () => {
    expect(validatePriceSource({})).toBeNull();
  });

  it('rejects a plain campaign that references an import', () => {
    expect(
      validatePriceSource({
        priceSource: CampaignPriceSource.SHOPIFY_CURRENT,
        csvImportId: 'some-id',
      }),
    ).toMatch(/Only a sheet campaign/);
  });

  it('rejects a sheet campaign with no import', () => {
    expect(
      validatePriceSource({ priceSource: CampaignPriceSource.SHEET }),
    ).toMatch(/must reference the uploaded file/);
  });

  it('accepts a sheet campaign with an import', () => {
    expect(
      validatePriceSource({
        priceSource: CampaignPriceSource.SHEET,
        csvImportId: 'some-id',
      }),
    ).toBeNull();
  });

  it('rejects a sheet campaign that also carries targets', () => {
    // Silently discarding them would price products the merchant did not
    // expect; the file's SKU list is the scope.
    expect(
      validatePriceSource({
        priceSource: CampaignPriceSource.SHEET,
        csvImportId: 'some-id',
        targets: [{}],
      }),
    ).toMatch(/cannot also have targets/);
  });
});

describe('validateCampaign', () => {
  it('reports the adjustment problem first when several are wrong', () => {
    const problem = validateCampaign(
      {
        adjustmentUnit: PERCENT,
        priceSource: CampaignPriceSource.SHEET,
      },
      { isCreate: true },
    );
    // One clear reason beats a list the merchant has to work through.
    expect(problem).toMatch(/unit, a direction and a value/);
  });

  it('passes a fully valid campaign', () => {
    expect(
      validateCampaign(
        {
          adjustmentUnit: PERCENT,
          adjustmentDirection: DOWN,
          adjustmentValue: '20',
          startAt: '2099-01-01T00:00:00.000Z',
          endAt: '2099-02-01T00:00:00.000Z',
          startTimezone: 'Asia/Dhaka',
          endTimezone: 'Asia/Dhaka',
          priceSource: CampaignPriceSource.SHOPIFY_CURRENT,
        },
        { isCreate: true },
      ),
    ).toBeNull();
  });
});
