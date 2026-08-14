import {
  CampaignAdjustmentDirection,
  CampaignAdjustmentUnit,
  CampaignBasis,
  CampaignIncludeMode,
  CampaignPriceSource,
  CampaignStatus,
  CampaignTargetMode,
  CampaignTargetType,
  DuplicatePolicy,
  isMoney,
  type CreateCampaignRequest,
  type Money,
} from '@pricelogic/shared';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { validateCampaign } from '../campaign-rules';

/** Field-level check for a decimal money string. */
@ValidatorConstraint({ name: 'IsMoneyString' })
export class IsMoneyStringConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return value === null || value === undefined || isMoney(value);
  }
  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be a number with up to four decimal places.`;
  }
}

/**
 * The cross-field rules, run as one constraint on the whole object.
 *
 * They live in `campaign-rules.ts` as pure functions and are only *wired* here
 * — per the phase brief, validation belongs in the DTO rather than the
 * controller body, and per the constitution the same rules have to be callable
 * from the sheet-approval path that builds a campaign server-side.
 */
@ValidatorConstraint({ name: 'CampaignConsistency' })
export class CampaignConsistencyConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const object = args.object as Record<string, unknown>;
    return (
      validateCampaign(object, { isCreate: object.__isCreate === true }) ===
      null
    );
  }

  defaultMessage(args: ValidationArguments): string {
    const object = args.object as Record<string, unknown>;
    return (
      validateCampaign(object, { isCreate: object.__isCreate === true }) ??
      'The campaign configuration is not valid.'
    );
  }
}

export class CampaignTargetInputDto {
  @IsEnum(CampaignTargetMode)
  mode!: CampaignTargetMode;

  @IsEnum(CampaignTargetType)
  targetType!: CampaignTargetType;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  targetValue!: string;
}

export class CreateCampaignDto implements CreateCampaignRequest {
  /**
   * Marks this as a create for the shared rules, which only reject a start
   * date in the past on create — an existing campaign's start date is history
   * and editing an unrelated field must not fail because of it.
   */
  readonly __isCreate = true;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsEnum(CampaignPriceSource)
  priceSource?: CampaignPriceSource;

  @IsOptional()
  @IsUUID()
  csvImportId?: string | null;

  @IsOptional()
  @IsEnum(CampaignAdjustmentUnit)
  adjustmentUnit?: CampaignAdjustmentUnit | null;

  @IsOptional()
  @IsEnum(CampaignAdjustmentDirection)
  adjustmentDirection?: CampaignAdjustmentDirection | null;

  @IsOptional()
  @Validate(IsMoneyStringConstraint)
  adjustmentValue?: Money | null;

  @IsOptional()
  @IsEnum(CampaignBasis)
  basis?: CampaignBasis;

  @IsOptional()
  @Validate(IsMoneyStringConstraint)
  roundTo?: Money | null;

  @IsOptional()
  @IsEnum(['UP', 'DOWN', 'NEAREST'])
  roundStrategy?: 'UP' | 'DOWN' | 'NEAREST';

  @IsOptional()
  @IsBoolean()
  setCompareAt?: boolean;

  @IsOptional()
  @IsEnum(DuplicatePolicy)
  duplicatePolicy?: DuplicatePolicy | null;

  @IsOptional()
  @IsEnum(CampaignIncludeMode)
  includeMode?: CampaignIncludeMode;

  @IsOptional()
  @IsBoolean()
  excludeDraftArchived?: boolean;

  @IsOptional()
  @IsBoolean()
  exclusionsEnabled?: boolean;

  @IsOptional()
  @IsArray()
  // A campaign with 5,000 hand-picked targets is a bulk import, not a form
  // submission, and would make the resolver's query unbounded.
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CampaignTargetInputDto)
  targets?: CampaignTargetInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  addTags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  removeTags?: string[];

  @IsOptional()
  @IsISO8601()
  startAt?: string | null;

  @IsOptional()
  @IsString()
  startTimezone?: string;

  @IsOptional()
  @IsISO8601()
  endAt?: string | null;

  @IsOptional()
  @IsString()
  endTimezone?: string;

  @Validate(CampaignConsistencyConstraint)
  readonly __consistency = true;
}

/**
 * Every field optional. The service rejects an update to a campaign that is
 * not editable, so this only has to describe the shape.
 */
export class UpdateCampaignDto {
  readonly __isCreate = false;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsEnum(CampaignPriceSource)
  priceSource?: CampaignPriceSource;

  @IsOptional()
  @IsUUID()
  csvImportId?: string | null;

  @IsOptional()
  @IsEnum(CampaignAdjustmentUnit)
  adjustmentUnit?: CampaignAdjustmentUnit | null;

  @IsOptional()
  @IsEnum(CampaignAdjustmentDirection)
  adjustmentDirection?: CampaignAdjustmentDirection | null;

  @IsOptional()
  @Validate(IsMoneyStringConstraint)
  adjustmentValue?: Money | null;

  @IsOptional()
  @IsEnum(CampaignBasis)
  basis?: CampaignBasis;

  @IsOptional()
  @Validate(IsMoneyStringConstraint)
  roundTo?: Money | null;

  @IsOptional()
  @IsEnum(['UP', 'DOWN', 'NEAREST'])
  roundStrategy?: 'UP' | 'DOWN' | 'NEAREST';

  @IsOptional()
  @IsBoolean()
  setCompareAt?: boolean;

  @IsOptional()
  @IsEnum(DuplicatePolicy)
  duplicatePolicy?: DuplicatePolicy | null;

  @IsOptional()
  @IsEnum(CampaignIncludeMode)
  includeMode?: CampaignIncludeMode;

  @IsOptional()
  @IsBoolean()
  excludeDraftArchived?: boolean;

  @IsOptional()
  @IsBoolean()
  exclusionsEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  addTags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  removeTags?: string[];

  @IsOptional()
  @IsISO8601()
  startAt?: string | null;

  @IsOptional()
  @IsString()
  startTimezone?: string;

  @IsOptional()
  @IsISO8601()
  endAt?: string | null;

  @IsOptional()
  @IsString()
  endTimezone?: string;

  @Validate(CampaignConsistencyConstraint)
  readonly __consistency = true;
}

export class ListCampaignsDto {
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(250)
  pageSize?: number;
}

export class ChangeCampaignStatusDto {
  @IsEnum(CampaignStatus)
  status!: CampaignStatus;
}
