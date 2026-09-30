import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [SubscriptionsModule, AccountModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
