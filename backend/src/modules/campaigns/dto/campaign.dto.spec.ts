import { ValidationPipe } from '@nestjs/common';
import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
} from '@pricelogic/shared';
import { CreateCampaignDto, UpdateCampaignDto } from './campaign.dto';

/**
 * The campaign DTOs through the **real** pipe, configured exactly as `main.ts`
 * configures it.
 *
 * Validating with `class-validator` directly would not have caught the bug this
 * suite exists for: `whitelist` + `forbidNonWhitelisted` reject any property on
 * the instance that carries no validation decorator, and a class field with a
 * default is such a property even when the client never sent it. Every campaign
 * create and update was returning 400 `property __isCreate should not exist`
 * while every unit test passed, because the tests called the service and never
 * the pipe.
 */
describe('campaign DTO validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  const create = (body: Record<string, unknown>) =>
    pipe.transform(body, {
      type: 'body',
      metatype: CreateCampaignDto,
      data: '',
    });

  const update = (body: Record<string, unknown>) =>
    pipe.transform(body, {
      type: 'body',
      metatype: UpdateCampaignDto,
      data: '',
    });

  const validBody = {
    title: 'Summer sale',
    adjustmentUnit: CampaignAdjustmentUnit.PERCENTAGE,
    adjustmentDirection: CampaignAdjustmentDirection.DECREASE,
    adjustmentValue: '20.0000',
  };

  describe('a well-formed campaign', () => {
    it('is accepted on create', async () => {
      await expect(create({ ...validBody })).resolves.toMatchObject({
        title: 'Summer sale',
      });
    });

    it('is accepted on update', async () => {
      await expect(update({ title: 'Renamed' })).resolves.toMatchObject({
        title: 'Renamed',
      });
    });

    it('accepts an update carrying nothing at all', async () => {
      // Every field is optional, so an empty edit is legal — and the
      // object-level rules must not reject one for having no adjustment.
      await expect(update({})).resolves.toBeDefined();
    });
  });

  describe('control fields', () => {
    it('does not require the client to send anything undeclared', async () => {
      // The regression: no marker field may be needed on the wire, because a
      // property without a validation decorator is rejected outright.
      await expect(create({ ...validBody })).resolves.toBeDefined();
    });

    it('cannot be talked out of the rules by a client-supplied anchor', async () => {
      /*
       * `__consistency` is whitelisted — it carries `@Validate`, so a client may
       * send it and class-transformer will overwrite our default with theirs.
       * That has to stay harmless: the constraint reads the whole DTO and
       * ignores this value, so setting it false disables nothing.
       */
      await expect(
        create({
          ...validBody,
          __consistency: false,
          startAt: '2020-01-01T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects an unknown property rather than silently dropping it', async () => {
      // The whole point of forbidNonWhitelisted: a typo'd field name should
      // say so, not be quietly ignored and leave the merchant wondering why
      // the setting did nothing.
      await expect(
        create({ ...validBody, adjustmnetValue: '20.0000' }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('cross-field rules', () => {
    it('rejects an adjustment missing its unit', async () => {
      await expect(
        create({ title: 'Sale', adjustmentValue: '20.0000' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects a start date in the past on create', async () => {
      await expect(
        create({ ...validBody, startAt: '2020-01-01T00:00:00.000Z' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('allows a past start date on update', async () => {
      /*
       * The one rule that differs between the two. An existing campaign's start
       * date is history: renaming a campaign that started last week must not
       * fail because last week is in the past.
       */
      await expect(
        update({ title: 'Renamed', startAt: '2020-01-01T00:00:00.000Z' }),
      ).resolves.toBeDefined();
    });

    it('rejects an end date before its start on either', async () => {
      const window = {
        startAt: '2099-06-01T00:00:00.000Z',
        endAt: '2099-05-01T00:00:00.000Z',
      };
      await expect(create({ ...validBody, ...window })).rejects.toMatchObject({
        status: 400,
      });
      await expect(update(window)).rejects.toMatchObject({ status: 400 });
    });
  });
});
