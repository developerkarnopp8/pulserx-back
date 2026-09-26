import { Module } from '@nestjs/common';
import { SubscriptionAccessService } from './subscription-access.service';
import { SubscriptionPlansService } from './subscription-plans.service';

@Module({
  providers: [SubscriptionAccessService, SubscriptionPlansService],
  exports: [SubscriptionAccessService, SubscriptionPlansService],
})
export class SubscriptionsModule {}
