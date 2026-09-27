import { Test } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';
import { PrismaService } from '../prisma/prisma.service';

describe('MessagesService.send', () => {
  let service: MessagesService;
  let prisma: { message: { create: jest.Mock } };
  let gateway: { emitToUser: jest.Mock };

  beforeEach(async () => {
    prisma = { message: { create: jest.fn() } };
    gateway = { emitToUser: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: MessagesGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get(MessagesService);
  });

  it('cria a mensagem com isSystem=false por padrao', async () => {
    prisma.message.create.mockResolvedValue({ id: '1', isSystem: false });

    await service.send('coach-1', 'athlete-1', 'oi');

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fromId: 'coach-1', toId: 'athlete-1', content: 'oi', isSystem: false } }),
    );
  });

  it('cria a mensagem com isSystem=true quando pedido', async () => {
    prisma.message.create.mockResolvedValue({ id: '2', isSystem: true });

    await service.send('athlete-1', 'coach-1', 'pulei o treino', true);

    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fromId: 'athlete-1', toId: 'coach-1', content: 'pulei o treino', isSystem: true } }),
    );
  });

  it('emite a mensagem em tempo real pro destinatario', async () => {
    const created = { id: '3', toId: 'coach-1', isSystem: true };
    prisma.message.create.mockResolvedValue(created);

    await service.send('athlete-1', 'coach-1', 'pulei', true);

    expect(gateway.emitToUser).toHaveBeenCalledWith('coach-1', created);
  });
});

describe('MessagesService.getConversation', () => {
  let service: MessagesService;
  let prisma: { message: { updateMany: jest.Mock; findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { message: { updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) } };
    const module = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: MessagesGateway, useValue: { emitToUser: jest.fn() } },
      ],
    }).compile();
    service = module.get(MessagesService);
  });

  it('marca como lidas as mensagens do outro pro usuario, depois busca a conversa ordenada', async () => {
    await service.getConversation('user-1', 'user-2');

    expect(prisma.message.updateMany).toHaveBeenCalledWith({
      where: { fromId: 'user-2', toId: 'user-1', read: false },
      data: { read: true },
    });
    expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ fromId: 'user-1', toId: 'user-2' }, { fromId: 'user-2', toId: 'user-1' }] },
      orderBy: { createdAt: 'asc' },
    }));
  });
});

describe('MessagesService.getInbox', () => {
  let service: MessagesService;
  let prisma: { message: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { message: { findMany: jest.fn() } };
    const module = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: MessagesGateway, useValue: { emitToUser: jest.fn() } },
      ],
    }).compile();
    service = module.get(MessagesService);
  });

  it('deduplica, mantendo so a mensagem mais recente por interlocutor', async () => {
    prisma.message.findMany.mockResolvedValue([
      { id: '3', fromId: 'user-1', toId: 'user-2' },
      { id: '2', fromId: 'user-2', toId: 'user-1' },
      { id: '1', fromId: 'user-1', toId: 'user-3' },
    ]);

    const result = await service.getInbox('user-1');

    expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ fromId: 'user-1' }, { toId: 'user-1' }] },
      orderBy: { createdAt: 'desc' },
    }));
    expect(result).toEqual([
      { id: '3', fromId: 'user-1', toId: 'user-2' },
      { id: '1', fromId: 'user-1', toId: 'user-3' },
    ]);
  });

  it('sem mensagens: devolve lista vazia', async () => {
    prisma.message.findMany.mockResolvedValue([]);
    await expect(service.getInbox('user-1')).resolves.toEqual([]);
  });
});

describe('MessagesService.unreadCount', () => {
  it('conta mensagens nao lidas destinadas ao usuario', async () => {
    const prisma = { message: { count: jest.fn().mockResolvedValue(4) } };
    const module = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: MessagesGateway, useValue: { emitToUser: jest.fn() } },
      ],
    }).compile();
    const service = module.get<MessagesService>(MessagesService);

    await expect(service.unreadCount('user-1')).resolves.toBe(4);
    expect(prisma.message.count).toHaveBeenCalledWith({ where: { toId: 'user-1', read: false } });
  });
});
