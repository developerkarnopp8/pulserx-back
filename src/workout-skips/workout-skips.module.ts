import { Module } from '@nestjs/common';
import { WorkoutSkipsService } from './workout-skips.service';
import { WorkoutSkipsController } from './workout-skips.controller';
import { MessagesModule } from '../messages/messages.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [MessagesModule, NotificationsModule, SubscriptionsModule],
  controllers: [WorkoutSkipsController],
  providers: [WorkoutSkipsService],
  exports: [WorkoutSkipsService],
})
export class WorkoutSkipsModule {}
