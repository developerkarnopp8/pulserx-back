import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionAccessService } from './subscription-access.service';
import { SubscriptionPlansService } from './subscription-plans.service';
import { PlanAccessService } from './plan-access.service';
import { SubscriptionsService } from './subscriptions.service';
import { CoachContractsService } from './coach-contracts.service';
import { PlatformSettingsService } from './platform-settings.service';
import { SubscriptionPlansController } from './subscription-plans.controller';
import { SubscriptionsController } from './subscriptions.controller';
import { AsaasService } from '../common/asaas.service';

@Module({
  imports: [NotificationsModule],
  controllers: [SubscriptionPlansController, SubscriptionsController],
  providers: [
    SubscriptionAccessService,
    SubscriptionPlansService,
    PlanAccessService,
    SubscriptionsService,
    CoachContractsService,
    PlatformSettingsService,
    AsaasService,
  ],
  exports: [
    SubscriptionAccessService,
    SubscriptionPlansService,
    PlanAccessService,
    SubscriptionsService,
    CoachContractsService,
    PlatformSettingsService,
    AsaasService,
  ],
})
export class SubscriptionsModule {}
