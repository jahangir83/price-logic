import { IsIn, IsNumber, IsOptional, Min } from 'class-validator';

const PRICING_STRATEGIES = [
  'PERCENTAGE_MARKUP',
  'FIXED_MARKUP',
  'TARGET_MARGIN',
] as const;

export class UpdateDefaultSettingsDto {
  @IsOptional()
  @IsIn(PRICING_STRATEGIES)
  defaultPricingStrategy?: (typeof PRICING_STRATEGIES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumMarginPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maximumPrice?: number;
}
