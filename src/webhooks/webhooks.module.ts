import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { AsaasService } from '../common/asaas.service';

@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, AsaasService],
})
export class WebhooksModule {}
