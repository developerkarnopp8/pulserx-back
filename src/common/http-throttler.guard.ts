import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * ThrottlerGuard global só faz sentido em HTTP: o guard padrão lê o objeto de resposta
 * (`res.header`) e quebra em handlers de WebSocket (`@SubscribeMessage`) com
 * "Cannot read properties of undefined (reading 'header')". O socket já é autenticado
 * por JWT na conexão (MessagesGateway.handleConnection), então mensagens WS não passam
 * pelo rate limit HTTP.
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    return super.canActivate(context);
  }
}
