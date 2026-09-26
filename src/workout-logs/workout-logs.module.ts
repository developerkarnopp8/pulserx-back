import { Module } from '@nestjs/common';
import { WorkoutLogsService } from './workout-logs.service';
import { WorkoutLogsController } from './workout-logs.controller';
import { StudentsModule } from '../students/students.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [StudentsModule, SubscriptionsModule],
  controllers: [WorkoutLogsController],
  providers: [WorkoutLogsService],
  exports: [WorkoutLogsService],
})
export class WorkoutLogsModule {}
