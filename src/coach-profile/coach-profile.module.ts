import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CoachProfileController } from './coach-profile.controller';
import { PublicProfileController } from './public-profile.controller';
import { CoachProfileService } from './coach-profile.service';
import { CloudinaryService } from '../common/cloudinary.service';
import { EmailService } from '../common/email.service';

@Module({
  imports: [NotificationsModule],
  controllers: [CoachProfileController, PublicProfileController],
  providers: [CoachProfileService, CloudinaryService, EmailService],
})
export class CoachProfileModule {}
