import { Test } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('MessagesController — guards', () => {
  it('exige JwtAuthGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MessagesController)).toEqual(
      expect.arrayContaining([JwtAuthGuard]),
    );
  });
});

describe('MessagesController — leitura', () => {
  let controller: MessagesController;
  let messagesService: { getInbox: jest.Mock; unreadCount: jest.Mock; getConversation: jest.Mock };

  beforeEach(async () => {
    messagesService = { getInbox: jest.fn(), unreadCount: jest.fn(), getConversation: jest.fn() };
    const module = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        { provide: MessagesService, useValue: messagesService },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();
    controller = module.get(MessagesController);
  });

  it('getInbox usa o id do usuario do token', () => {
    const req = { user: { id: 'user-1' } };
    controller.getInbox(req);
    expect(messagesService.getInbox).toHaveBeenCalledWith('user-1');
  });

  it('unread devolve { count }', async () => {
    messagesService.unreadCount.mockResolvedValue(3);
    await expect(controller.unread({ user: { id: 'user-1' } })).resolves.toEqual({ count: 3 });
  });

  it('getConversation repassa userId do token + otherId', () => {
    const req = { user: { id: 'user-1' } };
    controller.getConversation('user-2', req);
    expect(messagesService.getConversation).toHaveBeenCalledWith('user-1', 'user-2');
  });
});

describe('MessagesController.send — notifica o destinatario', () => {
  let controller: MessagesController;
  let messagesService: { send: jest.Mock };
  let notificationsService: { create: jest.Mock };

  beforeEach(async () => {
    messagesService = { send: jest.fn().mockResolvedValue({ id: 'msg-1' }) };
    notificationsService = { create: jest.fn() };

    const module = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        { provide: MessagesService, useValue: messagesService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    controller = module.get(MessagesController);
  });

  it('coach manda mensagem pro atleta -> notificacao com link pro athlete/messages', async () => {
    const req = { user: { id: 'coach-1', role: 'coach', name: 'Luan' } };

    await controller.send(req, { toId: 'athlete-1', content: 'Bom treino hoje!' });

    expect(notificationsService.create).toHaveBeenCalledWith(
      'athlete-1',
      'new_message',
      'Nova mensagem de Luan',
      'Bom treino hoje!',
      '/athlete/messages',
    );
  });

  it('atleta manda mensagem pro coach -> notificacao com link pro coach/messages', async () => {
    const req = { user: { id: 'athlete-1', role: 'athlete', name: 'Gustavo' } };

    await controller.send(req, { toId: 'coach-1', content: 'Pode ser amanha?' });

    expect(notificationsService.create).toHaveBeenCalledWith(
      'coach-1',
      'new_message',
      'Nova mensagem de Gustavo',
      'Pode ser amanha?',
      '/coach/messages',
    );
  });
});
