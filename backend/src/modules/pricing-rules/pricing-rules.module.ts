import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PricingRule } from './entities/pricing-rule.entity';
import { PricingRuleTarget } from './entities/pricing-rule-target.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PricingRule, PricingRuleTarget])],
  exports: [TypeOrmModule],
})
export class PricingRulesModule {}
