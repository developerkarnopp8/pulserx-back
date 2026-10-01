import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { AsaasService } from '../common/asaas.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, AsaasService],
})
export class WebhooksModule {}
