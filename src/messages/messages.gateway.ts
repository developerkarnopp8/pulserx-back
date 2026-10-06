import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ALLOWED_ORIGINS } from '../common/allowed-origins';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: {
    origin: ALLOWED_ORIGINS,
  },
  namespace: '/messages',
})
export class MessagesGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(private jwt: JwtService) {}

  handleConnection(client: Socket): void {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');
      const payload = this.jwt.verify<{ sub: string }>(token);
      client.data.userId = payload.sub;
      // Uma sala por usuário: todas as abas/dispositivos dele recebem o evento. O socket.io tira
      // o socket da sala sozinho ao desconectar — fechar uma aba não derruba as outras (antes,
      // um Map userId→socketId guardava só o último e o apagava ao fechar qualquer aba).
      client.join(MessagesGateway.userRoom(payload.sub));
    } catch {
      client.disconnect(true);
    }
  }

  static userRoom(userId: string): string {
    return `user:${userId}`;
  }

  /** Emite a mensagem em tempo real para o destinatário (sala vazia = ninguém conectado, no-op). */
  emitToUser(userId: string, message: object): void {
    this.server.to(MessagesGateway.userRoom(userId)).emit('new_message', message);
  }

  /** Emite uma notificação em tempo real para o destinatário — mesmo canal usado pras mensagens. */
  emitNotification(userId: string, notification: object): void {
    this.server.to(MessagesGateway.userRoom(userId)).emit('new_notification', notification);
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket): void {
    client.emit('pong');
  }
}
