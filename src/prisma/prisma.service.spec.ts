import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('onModuleInit conecta ao banco', async () => {
    const service = new PrismaService();
    const connect = jest.spyOn(service, '$connect').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connect).toHaveBeenCalled();
  });

  it('onModuleDestroy desconecta do banco', async () => {
    const service = new PrismaService();
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalled();
  });
});
