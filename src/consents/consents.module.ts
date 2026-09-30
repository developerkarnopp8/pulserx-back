import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConsentsController } from './consents.controller';
import { CoachTermsController } from './coach-terms.controller';
import { ConsentsService } from './consents.service';

@Module({
  imports: [AuthModule],
  controllers: [ConsentsController, CoachTermsController],
  providers: [ConsentsService],
})
export class ConsentsModule {}
