import { Module } from '@nestjs/common';
import { AdminAccessLogCleanupService } from './admin-access-log-cleanup.service';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AccountModule } from '../account/account.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SubscriptionsModule, AccountModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminService, AdminAccessLogCleanupService],
})
export class AdminModule {}
