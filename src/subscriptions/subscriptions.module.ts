import { Module } from '@nestjs/common';
import { SubscriptionAccessService } from './subscription-access.service';
import { SubscriptionPlansService } from './subscription-plans.service';
import { PlanAccessService } from './plan-access.service';

@Module({
  providers: [SubscriptionAccessService, SubscriptionPlansService, PlanAccessService],
  exports: [SubscriptionAccessService, SubscriptionPlansService, PlanAccessService],
})
export class SubscriptionsModule {}
